package com.repograph.core.agent;

/**
 * Agent 可观察步骤状态。
 *
 * @author leolu
 */
public enum AgentStepStatus {

    /** 步骤等待执行。 */
    PENDING,
    /** 步骤正在执行。 */
    RUNNING,
    /** 步骤成功完成。 */
    COMPLETED,
    /** 能力未启用或当前输入不适用，步骤被显式跳过。 */
    SKIPPED,
    /** 步骤执行失败。 */
    FAILED
}
