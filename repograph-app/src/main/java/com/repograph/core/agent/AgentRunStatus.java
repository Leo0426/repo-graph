package com.repograph.core.agent;

/**
 * Agent 运行生命周期状态。
 *
 * @author leolu
 */
public enum AgentRunStatus {

    /** 已创建，等待执行。 */
    QUEUED,
    /** 正在执行。 */
    RUNNING,
    /** 自动步骤完成，等待人工审核。 */
    WAITING_FOR_REVIEW,
    /** 工作流全部完成。 */
    COMPLETED,
    /** 部分步骤完成，但结果不完整。 */
    PARTIAL,
    /** 执行失败。 */
    FAILED,
    /** 用户取消执行。 */
    CANCELLED;

    /**
     * 判断状态是否终止后续自动执行。
     *
     * @return 终止状态返回 {@code true}
     */
    public boolean terminal() {
        return this == COMPLETED || this == PARTIAL || this == FAILED || this == CANCELLED;
    }
}
