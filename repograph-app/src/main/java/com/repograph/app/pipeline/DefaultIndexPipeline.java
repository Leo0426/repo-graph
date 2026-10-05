package com.repograph.app.pipeline;

import com.repograph.app.watcher.FileWatcherService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.pipeline.IndexProgressEvent;
import com.repograph.core.model.RelationEdge;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import com.repograph.core.parser.ParseStrategy;
import com.repograph.core.pipeline.IndexOptions;
import com.repograph.core.pipeline.IndexPipeline;
import com.repograph.core.pipeline.IndexResult;
import com.repograph.core.pipeline.IndexStore;
import com.repograph.core.util.PathUtil;
import com.repograph.core.util.ProjectIdUtil;
import com.repograph.framework.FrameworkDetector;
import com.repograph.graph.CodeGraph;
import com.repograph.parser.ParserDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

/**
 * 索引管道默认实现，编排文件扫描、增量过滤、解析、元数据增强、图构建、Embedding 和 Qdrant 写入。
 *
 * <p>流程顺序（与 CONTEXT.md 规范一致，不可打乱）：
 * <ol>
 *   <li>扫描文件（按扩展名分语言）</li>
 *   <li>增量过滤（SQLite MD5 缓存，跳过未变更文件；{@code noIncremental=true} 时跳过此步）</li>
 *   <li>并行解析（ForkJoinPool，产出 CodeUnit + RelationEdge）</li>
 *   <li>元数据增强（框架识别、入口点、测试标记）</li>
 *   <li>图内事务替换（保留稳定节点的外部入边）</li>
 *   <li>批量 Embedding（semantic + code 双向量）</li>
 *   <li>批量写入 Qdrant（批大小 256），成功后清除文件旧向量</li>
 *   <li>确认源码未变化后提交解析前 MD5；失败文件保留未完成标记</li>
 * </ol>
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class DefaultIndexPipeline implements IndexPipeline {

    private static final Logger log = LoggerFactory.getLogger(DefaultIndexPipeline.class);

    private final ParserDispatcher parserDispatcher;
    private final FrameworkDetector frameworkDetector;
    private final CodeGraph codeGraph;
    private final IncrementalIndexCache incrementalCache;
    private final IndexStore indexStore;
    private final SourceFileScanner sourceFileScanner;
    private final EmbeddingUpsertRunner embeddingUpsertRunner;
    private final ObjectProvider<FileWatcherService> fileWatcherServiceProvider;
    private final ApplicationEventPublisher eventPublisher;

    /**
     * 通过构造器注入所有依赖组件。
     *
     * @param parserDispatcher  解析器分发器，不为 {@code null}
     * @param frameworkDetector 框架识别器，不为 {@code null}
     * @param codeGraph         Neo4j 图写入门面，不为 {@code null}
     * @param incrementalCache  增量索引缓存，不为 {@code null}
     * @param indexStore        存储协调服务，封装图持久化和联动删除，不为 {@code null}
     * @param sourceFileScanner 源文件扫描器，不为 {@code null}
     * @param embeddingUpsertRunner Embedding 与向量写入执行器，不为 {@code null}
     * @param fileWatcherServiceProvider 文件监听服务 provider，用于避免启动期循环依赖
     * @param eventPublisher    Spring 事件发布器，用于索引进度通知
     */
    public DefaultIndexPipeline(ParserDispatcher parserDispatcher,
                                 FrameworkDetector frameworkDetector,
                                 CodeGraph codeGraph,
                                 IncrementalIndexCache incrementalCache,
                                 IndexStore indexStore,
                                 SourceFileScanner sourceFileScanner,
                                 EmbeddingUpsertRunner embeddingUpsertRunner,
                                 ObjectProvider<FileWatcherService> fileWatcherServiceProvider,
                                 ApplicationEventPublisher eventPublisher) {
        this.parserDispatcher = parserDispatcher;
        this.frameworkDetector = frameworkDetector;
        this.codeGraph = codeGraph;
        this.incrementalCache = incrementalCache;
        this.indexStore = indexStore;
        this.sourceFileScanner = sourceFileScanner;
        this.embeddingUpsertRunner = embeddingUpsertRunner;
        this.fileWatcherServiceProvider = fileWatcherServiceProvider;
        this.eventPublisher = eventPublisher;
    }

    /** {@inheritDoc} */
    @Override
    public IndexResult index(Path projectRoot, IndexOptions options) {
        String projectId = ProjectIdUtil.generateProjectId(projectRoot);
        return indexStore.withProjectMutation(projectId, () -> indexProject(projectRoot, options, projectId));
    }

    private IndexResult indexProject(Path projectRoot, IndexOptions options, String projectId) {
        IndexOptions opts = options != null ? options : IndexOptions.defaults();
        long startMs = System.currentTimeMillis();
        List<String> errors = Collections.synchronizedList(new ArrayList<>());
        log.info("Starting index for project '{}' at {}", projectId, projectRoot);
        if (!opts.incremental() || incrementalCache.hasPendingProjectDeletion(projectId)) {
            indexStore.removeProject(projectId);
        }

        List<Path> allFiles = sourceFileScanner.scan(projectRoot, opts);
        if (opts.incremental()) cleanupDeletedFiles(allFiles, projectRoot, projectId, errors);
        List<Path> files = opts.incremental()
                ? incrementalCache.filterChanged(allFiles, projectId, projectRoot) : allFiles;
        BatchCounts counts = indexFiles(files, projectRoot, opts, projectId, errors);

        FileWatcherService watcher = fileWatcherServiceProvider.getIfAvailable();
        if (watcher != null) watcher.start(projectId, projectRoot);
        long durationMs = System.currentTimeMillis() - startMs;
        log.info("Index complete: {} files, {} units, {} edges in {}ms ({} errors)",
                counts.parsed(), counts.units(), counts.edges(), durationMs, errors.size());
        return new IndexResult(allFiles.size(), counts.parsed(), allFiles.size() - files.size(),
                counts.degraded(), counts.units(), counts.edges(), durationMs, List.copyOf(errors));
    }

    private void cleanupDeletedFiles(List<Path> allFiles, Path projectRoot, String projectId, List<String> errors) {
        Set<String> currentPaths = allFiles.stream()
                .map(file -> PathUtil.toRelativePath(projectRoot, file)).collect(Collectors.toSet());
        Set<String> deletedPaths = new LinkedHashSet<>(
                incrementalCache.findDeletedPaths(allFiles, projectId, projectRoot));
        for (String graphPath : codeGraph.findFilePaths(projectId)) {
            if (!currentPaths.contains(graphPath)) deletedPaths.add(graphPath);
        }
        for (String path : deletedPaths) {
            Path source = projectRoot.resolve(path);
            // 过滤和访问失败不代表删除；只有确认不存在或已被目录替换才清理。
            if (!Files.notExists(source) && !Files.isDirectory(source)) continue;
            try {
                indexStore.removeFile(path, projectId);
            } catch (RuntimeException error) {
                log.warn("Deleted file cleanup failed for '{}': {}", path, error.getMessage());
                errors.add("Deleted file cleanup failed [" + path + "]: " + error.getMessage());
            }
        }
    }

    /** {@inheritDoc} */
    @Override
    public IndexResult indexFile(Path file, Path projectRoot, IndexOptions options) {
        String projectId = ProjectIdUtil.generateProjectId(projectRoot);
        return indexStore.withProjectMutation(projectId, () -> {
            long startMs = System.currentTimeMillis();
            if (incrementalCache.hasPendingProjectDeletion(projectId)) indexStore.removeProject(projectId);
            List<String> errors = Collections.synchronizedList(new ArrayList<>());
            IndexOptions opts = options != null ? options : IndexOptions.defaults();
            BatchCounts counts = indexFiles(List.of(file), projectRoot, opts, projectId, errors);
            return new IndexResult(1, counts.parsed(), 0, counts.degraded(), counts.units(), counts.edges(),
                    System.currentTimeMillis() - startMs, List.copyOf(errors));
        });
    }

    private BatchCounts indexFiles(List<Path> files, Path projectRoot, IndexOptions opts,
                                   String projectId, List<String> errors) {
        // 必须先登记重试状态；解析失败或进程退出后，路径仍可用于清理残留图和向量。
        incrementalCache.markDirty(files.stream().map(file -> PathUtil.toRelativePath(projectRoot, file)).toList(),
                projectId);
        Map<Path, String> fingerprints = incrementalCache.captureFingerprints(files);
        try {
            codeGraph.recordProject(projectId, projectRoot.toAbsolutePath().toString());
        } catch (RuntimeException error) {
            log.warn("Failed to record project metadata for '{}': {}", projectId, error.getMessage());
            errors.add("Graph project metadata write failed: " + error.getMessage());
        }

        ParseOptions parseOptions = new ParseOptions(
                opts.strategy() != null ? opts.strategy() : ParseStrategy.AUTO,
                opts.languages(), projectRoot, projectId);
        AtomicInteger parsedCount = new AtomicInteger();
        List<ParsedFile> parsedFiles = Collections.synchronizedList(new ArrayList<>());
        ForkJoinPool.commonPool().submit(() -> files.parallelStream().forEach(file -> {
            try {
                ParseResult parsed = parserDispatcher.dispatch(file, parseOptions);
                if (parsed.parserUsed() == null) {
                    errors.add("No parser succeeded [" + file + "]");
                } else {
                    parsedFiles.add(new ParsedFile(file, parsed));
                }
            } catch (Exception error) {
                log.warn("Parse error for {}: {}", file, error.getMessage());
                errors.add("Parse error [" + file + "]: " + error.getMessage());
            } finally {
                publishProgress(projectRoot.toString(), "parsing", parsedCount.incrementAndGet(), files.size());
            }
        })).join();

        Map<String, List<CodeUnit>> replacements = new LinkedHashMap<>();
        List<CodeUnit> units = new ArrayList<>();
        List<RelationEdge> edges = new ArrayList<>();
        int degraded = 0;
        for (ParsedFile file : parsedFiles) {
            List<CodeUnit> enhanced = enhanceMetadata(file.result().units());
            replacements.put(PathUtil.toRelativePath(projectRoot, file.path()), enhanced);
            units.addAll(enhanced);
            edges.addAll(file.result().edges());
            if (file.result().degraded()) degraded++;
        }
        if (replacements.isEmpty()) return new BatchCounts(parsedCount.get(), degraded, 0, 0);
        try {
            // 图内原子替换，稳定 ID 节点保留未变更文件的入边；空文件参与清理。
            codeGraph.replaceFiles(replacements, edges, projectId);
        } catch (RuntimeException error) {
            log.warn("Graph replacement failed for '{}': {}", projectId, error.getMessage());
            errors.add("Graph replacement failed: " + error.getMessage());
            return new BatchCounts(parsedCount.get(), degraded, 0, 0);
        }

        var embedding = embeddingUpsertRunner.embedAndUpsert(units, projectId, projectRoot, errors,
                (root, done, total) -> publishProgress(root, "embedding", done, total));
        Set<String> failedFiles = new LinkedHashSet<>(embedding.failedFiles());
        failedFiles.addAll(embeddingUpsertRunner.removeStaleVectors(replacements, projectId, failedFiles, errors));
        List<Path> completedFiles = parsedFiles.stream().map(ParsedFile::path)
                .filter(file -> !failedFiles.contains(PathUtil.toRelativePath(projectRoot, file))).toList();
        commitFingerprints(completedFiles, fingerprints, projectId, projectRoot, errors);
        return new BatchCounts(parsedCount.get(), degraded, embedding.unitCount(), edges.size());
    }

    private void commitFingerprints(List<Path> files, Map<Path, String> fingerprints,
                                    String projectId, Path projectRoot, List<String> errors) {
        for (Path changed : incrementalCache.updateUnchangedEntries(files, fingerprints, projectId, projectRoot)) {
            String message = "Source changed during indexing or could not be read [" + changed + "]; retry required";
            log.warn(message);
            errors.add(message);
        }
    }

    private record ParsedFile(Path path, ParseResult result) {}

    private record BatchCounts(int parsed, int degraded, int units, int edges) {}

    // ── 第三步：元数据增强 ─────────────────────────────────────────

    private List<CodeUnit> enhanceMetadata(List<CodeUnit> units) {
        return units.stream().map(unit -> {
            Map<String, String> extra = frameworkDetector.detect(unit);
            if (extra.isEmpty()) return unit;
            Map<String, String> merged = new LinkedHashMap<>(unit.metadata());
            merged.putAll(extra);
            return new CodeUnit(unit.id(), unit.kind(), unit.language(),
                    unit.qualifiedName(), unit.simpleName(), unit.filePath(),
                    unit.startLine(), unit.endLine(), unit.rawSource(), unit.signature(),
                    unit.annotations(), unit.parentQualifiedName(), merged);
        }).collect(Collectors.toList());
    }

    /** 发布进度事件；无 publisher 时静默跳过（测试环境无 Spring 上下文）。 */
    private void publishProgress(String root, String stage, int done, int total) {
        eventPublisher.publishEvent(new IndexProgressEvent(root, stage, done, total));
    }
}
