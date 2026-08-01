package com.repograph.scanner;

import com.repograph.core.asset.AssetImportService;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.scanner.ExternalScanBatchResult;
import com.repograph.core.scanner.ExternalScanOptions;
import com.repograph.core.scanner.ExternalScanService;
import com.repograph.core.scanner.ScanBatchStatus;
import com.repograph.core.scanner.ScanTask;
import com.repograph.core.scanner.ScanTaskFindingsPage;
import com.repograph.core.scanner.ScanTaskService;
import com.repograph.core.scanner.ScanTaskStatus;
import com.repograph.core.scanner.ScanTaskNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;

/**
 * {@link ScanTaskService} 默认实现：提交时持久化 {@code QUEUED} 任务并交给 executor 异步执行，
 * 后台 {@link #runTask} 包裹现有同步 {@link ExternalScanService#scan}，把 {@link ScanBatchStatus}
 * 映射为任务终态。executor 与调度策略解耦，便于后续替换为带并发配额的调度器。
 *
 * @author leolu
 */
@Service
public class DefaultScanTaskService implements ScanTaskService {

    private static final Logger log = LoggerFactory.getLogger(DefaultScanTaskService.class);
    private static final int MAX_ERROR_CHARS = 500;

    private final ScanTaskStore store;
    private final ExternalScanService externalScanService;
    private final AssetImportService assetImportService;
    private final Executor executor;

    /** 正在执行的任务 → 执行线程，供取消 {@code RUNNING} 任务时中断以终止子进程。 */
    private final Map<String, Thread> running = new ConcurrentHashMap<>();

    /**
     * 创建异步扫描任务服务。
     *
     * @param store               任务存储
     * @param externalScanService 现有同步外部扫描编排
     * @param assetImportService  资产接入服务，重跑时据此重新定位托管资产
     * @param executor            任务执行 executor
     */
    public DefaultScanTaskService(
            ScanTaskStore store,
            ExternalScanService externalScanService,
            AssetImportService assetImportService,
            @Qualifier("scanTaskExecutor") Executor executor) {
        this.store = store;
        this.externalScanService = externalScanService;
        this.assetImportService = assetImportService;
        this.executor = executor;
    }

    @Override
    public ScanTask submit(ImportedAsset asset, ExternalScanOptions options) {
        String now = Instant.now().toString();
        ScanTask task = new ScanTask(
                UUID.randomUUID().toString(),
                asset.projectId(),
                asset.assetId(),
                options.scanners().stream().toList(),
                options.languages(),
                options.timeoutSeconds(),
                ScanTaskStatus.QUEUED,
                1,
                "",
                "",
                now,
                now);
        store.create(task);
        String taskId = task.id();
        executor.execute(() -> runTask(taskId));
        return task;
    }

    /**
     * 执行一次任务：{@code QUEUED -> RUNNING}，运行扫描器，落批次快照并迁移到终态。
     * 仅当任务当前处于 {@code QUEUED} 才会真正执行，避免重复或已取消任务被再次运行。
     *
     * @param taskId 任务标识
     */
    public void runTask(String taskId) {
        Optional<ScanTask> found = store.find(taskId);
        if (found.isEmpty()) {
            log.warn("Scan task not found, skip run: {}", taskId);
            return;
        }
        ScanTask task = found.get();
        if (!store.markRunning(taskId, Instant.now().toString())) {
            // 已被取消、已在运行或已终态：不重复执行。
            return;
        }
        running.put(taskId, Thread.currentThread());
        try {
            Optional<ImportedAsset> asset = assetImportService.find(task.assetId());
            if (asset.isEmpty()) {
                store.fail(taskId, "asset not found: " + task.assetId(), Instant.now().toString());
                return;
            }
            ExternalScanOptions options = new ExternalScanOptions(
                    new LinkedHashSet<>(task.scanners()), task.languages(), task.timeoutSeconds());
            ExternalScanBatchResult batch = externalScanService.scan(asset.get(), options);
            // 若期间被取消（状态已非 RUNNING），complete 为条件 no-op，CANCELLED 得以保留。
            store.complete(taskId, batch, mapStatus(batch.status()), Instant.now().toString());
        } catch (RuntimeException e) {
            log.warn("Scan task {} failed", taskId, e);
            // 取消导致的中断同样进入此分支，fail 为条件 no-op，不覆盖 CANCELLED。
            store.fail(taskId, structuredError(e), Instant.now().toString());
        } finally {
            running.remove(taskId);
            // 清除可能因取消/超时残留的中断标志，避免污染线程池中的下一个任务。
            Thread.interrupted();
        }
    }

    @Override
    public ScanTask cancel(String taskId) {
        ScanTask task = store.find(taskId)
                .orElseThrow(() -> new ScanTaskNotFoundException("scan task not found: " + taskId));
        String now = Instant.now().toString();
        if (store.cancelIfQueued(taskId, now)) {
            return store.find(taskId).orElse(task);
        }
        if (store.cancelIfRunning(taskId, now)) {
            Thread worker = running.get(taskId);
            if (worker != null) {
                worker.interrupt();
            }
            return store.find(taskId).orElse(task);
        }
        // 已终态或已取消：幂等 no-op。
        return task;
    }

    @Override
    public Optional<ScanTask> find(String taskId) {
        return store.find(taskId);
    }

    @Override
    public Optional<ExternalScanBatchResult> result(String taskId) {
        return store.result(taskId);
    }

    @Override
    public ScanTaskFindingsPage findings(String taskId, int page, int size) {
        if (store.find(taskId).isEmpty()) {
            throw new ScanTaskNotFoundException("scan task not found: " + taskId);
        }
        return store.findingsPage(taskId, page, size);
    }

    private static ScanTaskStatus mapStatus(ScanBatchStatus status) {
        return switch (status) {
            case SUCCEEDED -> ScanTaskStatus.SUCCEEDED;
            case PARTIAL -> ScanTaskStatus.PARTIAL;
            case FAILED -> ScanTaskStatus.FAILED;
        };
    }

    private static String structuredError(RuntimeException e) {
        String message = e.getMessage() == null ? "" : e.getMessage();
        String summary = e.getClass().getSimpleName() + (message.isBlank() ? "" : ": " + message);
        return summary.length() > MAX_ERROR_CHARS ? summary.substring(0, MAX_ERROR_CHARS) : summary;
    }
}
