package com.repograph.core.scanner;

import com.repograph.core.asset.ImportedAsset;

import java.util.Optional;

/**
 * 异步扫描任务编排边界：提交后立即返回 {@code QUEUED} 任务，后台执行现有
 * {@link ExternalScanService#scan}，并支持状态查询与分页取结果。
 *
 * @author leolu
 */
public interface ScanTaskService {

    /**
     * 提交一次异步扫描任务，立即返回 {@code QUEUED} 任务，不阻塞等待执行完成。
     *
     * @param asset   已就绪托管资产
     * @param options 扫描执行选项
     * @return 新建的 {@code QUEUED} 任务
     */
    ScanTask submit(ImportedAsset asset, ExternalScanOptions options);

    /**
     * 取消一个任务。{@code QUEUED} 任务将永不启动；{@code RUNNING} 任务会中断执行线程以终止
     * 正在运行的扫描器子进程，已完成扫描器的运行结果仍保留。终态任务为幂等 no-op。
     *
     * @param taskId 任务标识
     * @return 取消后的任务
     * @throws ScanTaskNotFoundException 任务不存在
     */
    ScanTask cancel(String taskId);

    /**
     * 重试一个 {@code FAILED} 或 {@code PARTIAL} 任务：只重跑其中未成功的扫描器，保留已成功扫描器的
     * 结果，合并后重算任务状态并 {@code attempt + 1}。依赖 {@code (project_id, fingerprint)} 幂等，
     * 重复报警不会重复写入。
     *
     * @param taskId 任务标识
     * @return 重新入队的任务
     * @throws ScanTaskNotFoundException 任务不存在
     * @throws IllegalArgumentException  任务当前状态不可重试
     */
    ScanTask retry(String taskId);

    /**
     * 按标识查询任务。
     *
     * @param taskId 任务标识
     * @return 任务；不存在时为空
     */
    Optional<ScanTask> find(String taskId);

    /**
     * 查询任务的批次执行结果快照（含各扫描器运行状态与失败原因）。
     *
     * @param taskId 任务标识
     * @return 批次结果；任务未运行完成时为空
     */
    Optional<ExternalScanBatchResult> result(String taskId);

    /**
     * 分页查询任务去重后的归一化报警。
     *
     * @param taskId 任务标识
     * @param page   页码，从 0 起
     * @param size   每页大小
     * @return 一页报警
     * @throws ScanTaskNotFoundException 任务不存在
     */
    ScanTaskFindingsPage findings(String taskId, int page, int size);
}
