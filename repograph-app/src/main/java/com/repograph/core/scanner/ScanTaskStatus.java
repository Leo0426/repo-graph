package com.repograph.core.scanner;

/**
 * 异步扫描任务状态机。
 *
 * <p>迁移：{@code QUEUED -> RUNNING -> (SUCCEEDED | PARTIAL | FAILED)}；
 * {@code QUEUED} 或 {@code RUNNING} 可被取消为 {@code CANCELLED}。
 *
 * @author leolu
 */
public enum ScanTaskStatus {
    /** 已入队，等待调度。 */
    QUEUED,
    /** 正在执行扫描器。 */
    RUNNING,
    /** 所有扫描器均成功。 */
    SUCCEEDED,
    /** 至少一个扫描器成功且至少一个未成功。 */
    PARTIAL,
    /** 没有扫描器成功，或任务级执行失败。 */
    FAILED,
    /** 任务被主动取消。 */
    CANCELLED;

    /**
     * 是否为终态。
     *
     * @return 终态返回 {@code true}
     */
    public boolean isTerminal() {
        return this == SUCCEEDED || this == PARTIAL || this == FAILED || this == CANCELLED;
    }
}
