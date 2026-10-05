package com.repograph.app.watcher;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.pipeline.IndexOptions;
import com.repograph.core.pipeline.IndexPipeline;
import com.repograph.core.pipeline.IndexStore;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.ClosedWatchServiceException;
import java.nio.file.FileSystems;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.WatchEvent;
import java.nio.file.WatchKey;
import java.nio.file.WatchService;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import static java.nio.file.StandardWatchEventKinds.ENTRY_CREATE;
import static java.nio.file.StandardWatchEventKinds.ENTRY_DELETE;
import static java.nio.file.StandardWatchEventKinds.ENTRY_MODIFY;
import static java.nio.file.StandardWatchEventKinds.OVERFLOW;

/**
 * 基于 {@link WatchService} 的文件系统监听服务。
 *
 * <p>监听逻辑：
 * <ol>
 *   <li>递归注册项目根目录下的所有子目录（跳过 {@code .git}、{@code build}、{@code target} 等构建目录）</li>
 *   <li>后台线程阻塞等待文件事件；发现新目录时自动补注册</li>
 *   <li>每次文件变更后启动 {@value DEBOUNCE_MILLIS}ms 防抖计时，最后一次事件后触发增量重索引</li>
 *   <li>重索引在独立线程运行，不阻塞监听循环</li>
 * </ol>
 *
 * @author leolu
 * @since 0.4.0
 */
@Service
public class FileWatcherService {

    private static final Logger log = LoggerFactory.getLogger(FileWatcherService.class);

    /** 文件事件结束到触发重索引的等待时间（毫秒）。 */
    static final long DEBOUNCE_MILLIS = 3_000;

    /** 注册时跳过的目录名，避免监听构建产物和版本控制内部目录。 */
    private static final Set<String> SKIP_DIRS = Set.of(
            ".git", ".gradle", ".idea", ".venv", "__pycache__",
            "build", "target", "out", "node_modules", ".terraform"
    );

    private final IndexPipeline indexPipeline;
    private final IndexStore indexStore;
    private final GraphQueryService graphQueryService;

    private WatchService watchService;
    private Thread watchThread;
    private volatile boolean closed;

    /** projectId → 监听条目 */
    private final ConcurrentHashMap<String, WatchedProject> watched = new ConcurrentHashMap<>();
    /** WatchKey → projectId（反向查找）*/
    private final ConcurrentHashMap<WatchKey, String> keyToProject = new ConcurrentHashMap<>();
    /** WatchKey → 对应目录（解析事件相对路径）*/
    private final ConcurrentHashMap<WatchKey, Path> keyToDir = new ConcurrentHashMap<>();

    /** 防抖调度器：每个 projectId 最多一个待执行任务 */
    private final ScheduledExecutorService debounce = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "repograph-watch-debounce");
        t.setDaemon(true);
        return t;
    });
    private final ConcurrentHashMap<String, ScheduledFuture<?>> pending = new ConcurrentHashMap<>();

    /**
     * 创建文件监听服务。
     *
     * @param indexPipeline 增量索引流水线
     * @param indexStore 项目变更协调边界
     * @param graphQueryService 启动时恢复项目监听的查询服务
     */
    public FileWatcherService(IndexPipeline indexPipeline, IndexStore indexStore,
                              GraphQueryService graphQueryService) {
        this.indexPipeline = indexPipeline;
        this.indexStore = indexStore;
        this.graphQueryService = graphQueryService;
    }

    /**
     * 创建系统文件监听器并启动事件线程。
     *
     * @throws IOException 无法创建系统文件监听器时抛出
     */
    @PostConstruct
    public void init() throws IOException {
        watchService = FileSystems.getDefault().newWatchService();
        watchThread = new Thread(this::watchLoop, "repograph-file-watcher");
        watchThread.setDaemon(true);
        watchThread.start();
        log.info("FileWatcherService started");
    }

    /** 停止接收文件事件，并使尚未取得项目变更权限的重索引任务失效。 */
    @PreDestroy
    public void shutdown() {
        closed = true;
        watchThread.interrupt();
        debounce.shutdownNow();
        try { watchService.close(); } catch (IOException ignored) {}
        log.info("FileWatcherService stopped");
    }

    /**
     * Spring 容器完全就绪后，从 Neo4j 项目注册表中恢复所有已知项目的文件监听。
     *
     * <p>使用 {@link ApplicationReadyEvent}（而非 {@code @PostConstruct}）确保 Neo4j
     * Driver 和所有 Bean 都已初始化完毕。根目录不存在时静默跳过。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void restoreWatchers() {
        try {
            var projects = graphQueryService.listProjects();
            if (projects.isEmpty()) return;
            log.info("Restoring file watchers for {} project(s)", projects.size());
            for (var p : projects) {
                if (p.projectRoot() == null || p.projectRoot().isBlank()) continue;
                Path root = Path.of(p.projectRoot());
                if (!Files.isDirectory(root)) {
                    log.debug("Skipping watch restore for '{}': root '{}' not found",
                            p.projectId(), p.projectRoot());
                    continue;
                }
                start(p.projectId(), root);
            }
        } catch (Exception e) {
            log.warn("Failed to restore watchers from registry: {}", e.getMessage());
        }
    }

    /**
     * 开始监听指定项目。已在监听的项目幂等处理（不重复注册）。
     *
     * @param projectId 项目唯一标识符
     * @param root      项目根目录绝对路径
     */
    public void start(String projectId, Path root) {
        indexStore.withProjectMutation(projectId, () -> {
            if (closed || watched.containsKey(projectId)) return null;
            if (!Files.isDirectory(root)) {
                log.debug("Skipping watch for '{}': '{}' is not a directory", projectId, root);
                return null;
            }
            try {
                List<WatchKey> keys = new ArrayList<>();
                registerAll(root, projectId, keys);
                watched.put(projectId, new WatchedProject(projectId, root, keys));
                log.info("Watching project '{}' at {}", projectId, root);
            } catch (IOException | ClosedWatchServiceException e) {
                if (!closed) log.warn("Failed to register watch for '{}': {}", projectId, e.getMessage());
            }
            return null;
        });
    }

    /**
     * 停止监听指定项目，取消所有已注册的 {@link WatchKey}。
     *
     * @param projectId 项目唯一标识符
     */
    public void stop(String projectId) {
        indexStore.withProjectMutation(projectId, () -> {
            WatchedProject wp = watched.remove(projectId);
            if (wp == null) return null;
            synchronized (wp) {
                ScheduledFuture<?> f = pending.remove(projectId);
                if (f != null) f.cancel(false);
                for (WatchKey key : wp.keys()) {
                    keyToProject.remove(key);
                    keyToDir.remove(key);
                    key.cancel();
                }
            }
            log.info("Stopped watching project '{}'", projectId);
            return null;
        });
    }

    /** 返回当前正在监听的项目列表（不可变副本）。 */
    public List<WatchedProject> list() {
        if (closed) return List.of();
        return Collections.unmodifiableList(new ArrayList<>(watched.values()));
    }

    /** 判断指定项目是否正在被监听。 */
    public boolean isWatching(String projectId) {
        return !closed && watched.containsKey(projectId);
    }

    // ── 内部方法 ─────────────────────────────────────────────────────────────

    private void registerAll(Path root, String projectId, List<WatchKey> keys) throws IOException {
        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                if (SKIP_DIRS.contains(dir.getFileName().toString())) {
                    return FileVisitResult.SKIP_SUBTREE;
                }
                WatchKey key = dir.register(watchService, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
                keys.add(key);
                keyToProject.put(key, projectId);
                keyToDir.put(key, dir);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException e) {
                log.debug("Skipping inaccessible path {}: {}", file, e.getMessage());
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private void watchLoop() {
        while (!Thread.currentThread().isInterrupted()) {
            WatchKey key;
            try {
                key = watchService.take();
            } catch (InterruptedException | ClosedWatchServiceException e) {
                break;
            }

            Path dir = keyToDir.get(key);
            String projectId = keyToProject.get(key);

            if (dir != null && projectId != null) {
                WatchedProject wp = watched.get(projectId);
                if (wp != null) processEvents(key, dir, wp);
            }

            if (!key.reset()) {
                keyToProject.remove(key);
                keyToDir.remove(key);
            }
        }
    }

    private void processEvents(WatchKey key, Path dir, WatchedProject wp) {
        synchronized (wp) {
            if (closed || watched.get(wp.projectId()) != wp || !wp.keys().contains(key)) return;
            for (WatchEvent<?> event : key.pollEvents()) {
                if (event.kind() == OVERFLOW) continue;
                @SuppressWarnings("unchecked")
                Path child = dir.resolve(((WatchEvent<Path>) event).context());
                if (event.kind() == ENTRY_CREATE && Files.isDirectory(child)) {
                    try {
                        List<WatchKey> newKeys = new ArrayList<>();
                        registerAll(child, wp.projectId(), newKeys);
                        wp.keys().addAll(newKeys);
                    } catch (IOException | ClosedWatchServiceException e) {
                        if (!closed) log.debug("Failed to register new dir {}: {}", child, e.getMessage());
                    }
                }
                // 删除与重建可能合并；由持有项目锁的下一轮扫描判断当前文件状态。
                scheduleReindex(wp);
            }
        }
    }

    private void scheduleReindex(WatchedProject wp) {
        synchronized (wp) {
            if (closed || watched.get(wp.projectId()) != wp) return;
            ScheduledFuture<?> existing = pending.remove(wp.projectId());
            if (existing != null) existing.cancel(false);
            try {
                ScheduledFuture<?> future = debounce.schedule(
                        () -> triggerReindex(wp), DEBOUNCE_MILLIS, TimeUnit.MILLISECONDS);
                pending.put(wp.projectId(), future);
            } catch (RejectedExecutionException e) {
                if (!closed) throw e;
            }
        }
    }

    private void triggerReindex(WatchedProject wp) {
        String projectId = wp.projectId();
        Thread reindexThread = new Thread(() -> {
            try {
                indexStore.withProjectMutation(projectId, () -> {
                    // 等待锁期间可能已停止或重新注册监听，旧任务不能重建已删除的项目。
                    if (closed || watched.get(projectId) != wp) return null;
                    log.info("File change detected — re-indexing '{}'", projectId);
                    indexPipeline.index(wp.root(), IndexOptions.defaults());
                    log.info("Auto re-index complete for '{}'", projectId);
                    return null;
                });
            } catch (Exception e) {
                log.error("Auto re-index failed for '{}': {}", projectId, e.getMessage(), e);
            }
        }, "repograph-auto-reindex-" + projectId);
        reindexThread.setDaemon(true);
        reindexThread.start();
    }
}
