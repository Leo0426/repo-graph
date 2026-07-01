package com.repograph.api;

import com.repograph.app.pipeline.IndexHistoryStore;
import com.repograph.core.pipeline.IndexOptions;
import com.repograph.core.pipeline.IndexPipeline;
import com.repograph.core.pipeline.IndexProgressEvent;
import com.repograph.core.pipeline.IndexResult;
import com.repograph.core.pipeline.IndexStore;
import com.repograph.core.parser.ParseStrategy;
import com.repograph.vuln.VulnStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * 索引管道 REST API，支持异步触发项目索引和增量文件索引。
 *
 * <p>项目索引（{@code POST /project}）立即返回 202 Accepted，embedding 在后台线程执行；
 * 通过 {@code GET /project/status?projectRoot=...} 轮询进度。
 *
 * @author leolu
 * @since 0.1.0
 */
@RestController
@RequestMapping("/api/v1/index")
public class IndexController {

    private static final Logger log = LoggerFactory.getLogger(IndexController.class);

    /** 后台 embedding 专用单线程池，避免占用 Tomcat 请求线程。 */
    private static final Executor INDEX_EXECUTOR = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "repograph-index");
        t.setDaemon(true);
        return t;
    });

    /** 各 projectRoot 的最新索引状态：running / done / error。 */
    private final Map<String, String> statusMap = new ConcurrentHashMap<>();

    /** 各 projectRoot 的最新索引结果（完成后写入）。 */
    private final Map<String, IndexResult> resultMap = new ConcurrentHashMap<>();

    /** 各 projectRoot 的最新进度事件（索引过程中持续更新）。 */
    private final Map<String, IndexProgressEvent> progressMap = new ConcurrentHashMap<>();

    @EventListener
    public void onIndexProgress(IndexProgressEvent event) {
        progressMap.put(event.projectRoot(), event);
    }

    private final IndexPipeline indexPipeline;
    private final IndexStore indexStore;
    private final IndexHistoryStore indexHistoryStore;
    private final VulnStore vulnStore;

    /**
     * 通过构造器注入索引管道、存储协调器和历史持久化服务。
     *
     * @param indexPipeline     索引管道实现，不为 {@code null}
     * @param indexStore        存储协调器（用于 DELETE 端点），不为 {@code null}
     * @param indexHistoryStore 索引历史持久化，不为 {@code null}
     * @param vulnStore         漏洞发现持久化（项目删除时一并清理），不为 {@code null}
     */
    public IndexController(IndexPipeline indexPipeline, IndexStore indexStore,
                           IndexHistoryStore indexHistoryStore, VulnStore vulnStore) {
        this.indexPipeline = indexPipeline;
        this.indexStore = indexStore;
        this.indexHistoryStore = indexHistoryStore;
        this.vulnStore = vulnStore;
    }

    /**
     * 异步触发对指定项目根目录的完整索引流程，立即返回 202 Accepted。
     *
     * <p>实际的 embedding 和向量写入在后台单线程执行，可通过
     * {@code GET /project/status?projectRoot=...} 轮询结果。
     *
     * @param projectRoot   项目根目录绝对路径，不为 {@code null}
     * @param lang          逗号分隔的目标语言，{@code null} 表示全部
     * @param strategy      解析策略，默认 {@code auto}
     * @param noIncremental 为 {@code true} 时强制全量重新索引，忽略 MD5 缓存
     * @return 202 Accepted，包含轮询提示
     */
    @PostMapping("/project")
    public ResponseEntity<Map<String, String>> indexProject(
            @RequestParam String projectRoot,
            @RequestParam(required = false) String lang,
            @RequestParam(required = false, defaultValue = "auto") String strategy,
            @RequestParam(required = false, defaultValue = "false") boolean noIncremental) {

        if ("running".equals(statusMap.get(projectRoot))) {
            return ResponseEntity.status(409)
                    .body(Map.of("status", "running", "message", "Indexing already in progress for this project"));
        }

        List<String> languages = lang != null ? List.of(lang.split(",")) : List.of();
        ParseStrategy parseStrategy = ParseStrategy.valueOf(strategy.toUpperCase());
        IndexOptions options = new IndexOptions(languages, parseStrategy, !noIncremental, null);

        statusMap.put(projectRoot, "running");
        resultMap.remove(projectRoot);

        CompletableFuture.runAsync(() -> {
            try {
                IndexResult result = indexPipeline.index(Path.of(projectRoot), options);
                resultMap.put(projectRoot, result);
                statusMap.put(projectRoot, "done");
                indexHistoryStore.save(projectRoot, "done", result);
                log.info("Async indexing completed for '{}': {} units, {} edges, {}ms",
                        projectRoot, result.totalUnits(), result.totalEdges(), result.durationMs());
            } catch (Exception e) {
                String errorStatus = "error: " + e.getMessage();
                statusMap.put(projectRoot, errorStatus);
                progressMap.remove(projectRoot);
                indexHistoryStore.save(projectRoot, errorStatus, null);
                log.error("Async indexing failed for '{}'", projectRoot, e);
            }
        }, INDEX_EXECUTOR);

        return ResponseEntity.accepted()
                .body(Map.of("status", "running",
                             "message", "Indexing started in background",
                             "pollUrl", "/api/v1/index/project/status?projectRoot=" + projectRoot));
    }

    /**
     * 查询指定项目的最新索引状态和结果。
     *
     * @param projectRoot 项目根目录绝对路径
     * @return 状态（running / done / error）及完成后的 {@link IndexResult}
     */
    @GetMapping("/project/status")
    public ResponseEntity<Map<String, Object>> indexStatus(@RequestParam String projectRoot) {
        String status = statusMap.get(projectRoot);
        IndexResult result = resultMap.get(projectRoot);
        IndexProgressEvent progress = progressMap.get(projectRoot);
        Map<String, Object> body = new java.util.LinkedHashMap<>();

        // 内存未命中：回退到持久化历史记录（重启后仍可用）
        if (status == null && result == null) {
            return indexHistoryStore.load(projectRoot)
                    .map(h -> {
                        Map<String, Object> b = new java.util.LinkedHashMap<>();
                        b.put("status", h.status());
                        b.put("indexedAt", h.indexedAt());
                        if (h.result() != null) {
                            IndexResult r = h.result();
                            b.put("totalFiles", r.totalFiles());
                            b.put("parsedFiles", r.parsedFiles());
                            b.put("totalUnits", r.totalUnits());
                            b.put("totalEdges", r.totalEdges());
                            b.put("durationMs", r.durationMs());
                            b.put("errors", r.errors());
                        }
                        return ResponseEntity.ok(b);
                    })
                    .orElseGet(() -> ResponseEntity.ok(Map.of("status", "idle")));
        }

        body.put("status", status);
        if (progress != null && result == null) {
            int pct = progress.total() > 0
                    ? (int) Math.round(100.0 * progress.done() / progress.total()) : 0;
            body.put("stage", progress.stage());
            body.put("done", progress.done());
            body.put("total", progress.total());
            body.put("pct", pct);
        }
        if (result != null) {
            body.put("totalFiles", result.totalFiles());
            body.put("parsedFiles", result.parsedFiles());
            body.put("totalUnits", result.totalUnits());
            body.put("totalEdges", result.totalEdges());
            body.put("durationMs", result.durationMs());
            body.put("errors", result.errors());
            progressMap.remove(projectRoot);
        }
        return ResponseEntity.ok(body);
    }

    /**
     * 对单个文件执行增量索引，同步执行（单文件耗时短，无需异步）。
     *
     * @param file        待索引的源文件绝对路径，必须存在且可读
     * @param projectRoot 项目根目录绝对路径，用于生成 projectId 和相对路径
     * @param strategy    解析策略，默认 {@code auto}
     * @return 索引结果统计 JSON
     */
    @PostMapping("/file")
    public ResponseEntity<IndexResult> indexFile(
            @RequestParam String file,
            @RequestParam String projectRoot,
            @RequestParam(required = false, defaultValue = "auto") String strategy) {

        ParseStrategy parseStrategy = ParseStrategy.valueOf(strategy.toUpperCase());
        IndexOptions options = new IndexOptions(List.of(), parseStrategy, true, null);
        IndexResult result = indexPipeline.indexFile(Path.of(file), Path.of(projectRoot), options);
        return ResponseEntity.ok(result);
    }

    /**
     * 删除指定 projectId 的所有索引数据（Neo4j 节点、Qdrant 向量、SQLite 缓存）。
     *
     * @param projectId 12 字符 projectId 前缀，不为 {@code null}
     * @return 200 OK 含 {@code {"status":"deleted","projectId":...}}；
     *         若 projectId 不存在也返回 200（幂等）
     */
    @DeleteMapping("/project")
    public ResponseEntity<Map<String, String>> deleteProject(
            @RequestParam String projectId,
            @RequestParam(required = false) String projectRoot) {
        log.info("DELETE project '{}'", projectId);
        indexStore.removeProject(projectId);
        vulnStore.removeProject(projectId);
        if (projectRoot != null) {
            indexHistoryStore.remove(projectRoot);
            statusMap.remove(projectRoot);
            resultMap.remove(projectRoot);
            progressMap.remove(projectRoot);
        }
        return ResponseEntity.ok(Map.of("status", "deleted", "projectId", projectId));
    }
}
