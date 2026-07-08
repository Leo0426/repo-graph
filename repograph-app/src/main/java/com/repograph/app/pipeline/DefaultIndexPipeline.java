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
 *   <li>图构建（CodeUnit + RelationEdge → Neo4j）</li>
 *   <li>批量 Embedding（semantic + code 双向量）</li>
 *   <li>批量写入 Qdrant（批大小 256）</li>
 *   <li>更新 SQLite 缓存（本轮索引文件的最新 MD5）</li>
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

    @Override
    public IndexResult index(Path projectRoot, IndexOptions options) {
        IndexOptions opts = options != null ? options : IndexOptions.defaults();
        long startMs = System.currentTimeMillis();
        List<String> errors = Collections.synchronizedList(new ArrayList<>());

        String projectId = ProjectIdUtil.generateProjectId(projectRoot);
        log.info("Starting index for project '{}' at {}", projectId, projectRoot);

        if (!opts.incremental()) {
            indexStore.removeProject(projectId);
        }

        // 注册 :Project 元数据节点，供 /api/v1/projects 接口列出当前项目
        try {
            codeGraph.recordProject(projectId, projectRoot.toAbsolutePath().toString());
        } catch (Exception e) {
            log.warn("Failed to record project metadata for '{}': {}", projectId, e.getMessage());
        }

        // 第一步：扫描文件
        List<Path> allFiles = sourceFileScanner.scan(projectRoot, opts);
        int totalFiles = allFiles.size();
        log.info("Found {} source files to scan", totalFiles);

        // 第二步：增量过滤（跳过未变更的文件）
        List<Path> files;
        if (!opts.incremental()) {
            files = allFiles;
            log.info("Incremental indexing disabled — reindexing all {} files", totalFiles);
        } else {
            Set<String> currentPaths = allFiles.stream()
                    .map(file -> PathUtil.toRelativePath(projectRoot, file))
                    .collect(Collectors.toSet());
            Set<String> deletedPaths = new LinkedHashSet<>(
                    incrementalCache.findDeletedPaths(allFiles, projectId, projectRoot));
            for (String graphPath : codeGraph.findFilePaths(projectId)) {
                if (!currentPaths.contains(graphPath)) deletedPaths.add(graphPath);
            }
            for (String deletedPath : deletedPaths) {
                indexStore.removeFile(deletedPath, projectId);
            }
            if (!deletedPaths.isEmpty()) {
                log.info("Incremental cleanup: removed {} deleted or migrated file(s)", deletedPaths.size());
            }
            files = incrementalCache.filterChanged(allFiles, projectId, projectRoot);
            int skipped = totalFiles - files.size();
            log.info("Incremental filter: {} changed, {} skipped", files.size(), skipped);
        }

        // 第三步：并行解析
        ParseOptions parseOptions = new ParseOptions(
                opts.strategy() != null ? opts.strategy() : ParseStrategy.AUTO,
                opts.languages(),
                projectRoot,
                projectId
        );

        AtomicInteger parsedCount = new AtomicInteger(0);
        List<ParseResult> parseResults = Collections.synchronizedList(new ArrayList<>());

        ForkJoinPool pool = ForkJoinPool.commonPool();
        pool.submit(() ->
                files.parallelStream().forEach(file -> {
                    try {
                        ParseResult result = parserDispatcher.dispatch(file, parseOptions);
                        parseResults.add(result);
                        int done = parsedCount.incrementAndGet();
                        publishProgress(projectRoot.toString(), "parsing", done, files.size());
                    } catch (Exception e) {
                        log.warn("Parse error for {}: {}", file, e.getMessage());
                        errors.add("Parse error [" + file + "]: " + e.getMessage());
                    }
                })
        ).join();

        // 合并所有解析结果，统计降级文件数量以供审计
        List<CodeUnit> allUnits = new ArrayList<>();
        List<RelationEdge> allEdges = new ArrayList<>();
        int degradedFiles = 0;
        for (ParseResult r : parseResults) {
            allUnits.addAll(r.units());
            allEdges.addAll(r.edges());
            if (r.degraded()) degradedFiles++;
        }
        if (degradedFiles > 0) {
            log.warn("Degraded to heuristic parser for {} / {} files (edges not extracted for these files)",
                    degradedFiles, parseResults.size());
        }

        // 第三步：元数据增强（框架检测）
        List<CodeUnit> enhancedUnits = enhanceMetadata(allUnits);

        // 第四步：构建图
        int graphEdges = buildGraph(enhancedUnits, allEdges, projectId);
        log.info("Graph built: {} units, {} edges", enhancedUnits.size(), graphEdges);

        // 第五至六步：批量向量化并写入
        int embeddedCount = embeddingUpsertRunner.embedAndUpsert(enhancedUnits, projectId, projectRoot, errors,
                (root, done, total) -> publishProgress(root, "embedding", done, total));

        // 第八步：更新增量缓存
        if (opts.incremental()) {
            incrementalCache.updateEntries(files, projectId, projectRoot);
        }

        long durationMs = System.currentTimeMillis() - startMs;
        log.info("Index complete: {} files, {} units, {} edges in {}ms",
                parsedCount.get(), embeddedCount, graphEdges, durationMs);

        // 自动注册文件监听，确保索引完成后的变更能被自动感知
        FileWatcherService fileWatcherService = fileWatcherServiceProvider.getIfAvailable();
        if (fileWatcherService != null) {
            fileWatcherService.start(projectId, projectRoot);
        }

        int skippedFiles = totalFiles - files.size();
        return new IndexResult(
                totalFiles, parsedCount.get(), skippedFiles, degradedFiles,
                embeddedCount, graphEdges, durationMs, List.copyOf(errors)
        );
    }

    @Override
    public IndexResult indexFile(Path file, Path projectRoot, IndexOptions options) {
        IndexOptions opts = options != null ? options : IndexOptions.defaults();
        long startMs = System.currentTimeMillis();
        List<String> errors = new ArrayList<>();

        String projectId = ProjectIdUtil.generateProjectId(projectRoot);
        String relPath = PathUtil.toRelativePath(projectRoot, file);
        log.info("Incremental indexing file '{}' in project '{}'", relPath, projectId);

        // 清除该文件的过期图数据与向量数据（通过 IndexStore 协调）
        indexStore.removeFile(relPath, projectId);

        // 解析单个文件
        ParseOptions parseOptions = new ParseOptions(
                opts.strategy() != null ? opts.strategy() : ParseStrategy.AUTO,
                opts.languages(),
                projectRoot,
                projectId
        );

        ParseResult parseResult = ParseResult.empty();
        try {
            parseResult = parserDispatcher.dispatch(file, parseOptions);
        } catch (Exception e) {
            log.warn("Parse error for {}: {}", file, e.getMessage());
            errors.add("Parse error [" + file + "]: " + e.getMessage());
        }

        List<CodeUnit> enhancedUnits = enhanceMetadata(new ArrayList<>(parseResult.units()));
        int graphEdges = buildGraph(enhancedUnits, new ArrayList<>(parseResult.edges()), projectId);
        int embeddedCount = embeddingUpsertRunner.embedAndUpsert(enhancedUnits, projectId, projectRoot, errors,
                (root, done, total) -> publishProgress(root, "embedding", done, total));

        // 更新增量缓存
        incrementalCache.updateEntries(List.of(file), projectId, projectRoot);

        long durationMs = System.currentTimeMillis() - startMs;
        log.info("File index complete: 1 file, {} units, {} edges in {}ms",
                embeddedCount, graphEdges, durationMs);

        return new IndexResult(1, 1, 0, parseResult.degraded() ? 1 : 0,
                embeddedCount, graphEdges, durationMs, List.copyOf(errors));
    }

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

    // ── 第四步：图构建 ────────────────────────────────────────────

    private int buildGraph(List<CodeUnit> units, List<RelationEdge> edges, String projectId) {
        try {
            codeGraph.addUnits(units, projectId);
        } catch (Exception e) {
            log.warn("Failed to write {} units to Neo4j: {}", units.size(), e.getMessage());
        }
        int edgeCount = edges.size();
        try {
            codeGraph.addEdges(edges);
        } catch (Exception e) {
            log.warn("Failed to write {} edges to Neo4j: {}", edges.size(), e.getMessage());
            edgeCount = 0;
        }
        return edgeCount;
    }

    /** 发布进度事件；无 publisher 时静默跳过（测试环境无 Spring 上下文）。 */
    private void publishProgress(String root, String stage, int done, int total) {
        eventPublisher.publishEvent(new IndexProgressEvent(root, stage, done, total));
    }
}
