package com.repograph.core.architecture;

/**
 * 架构模型评审状态。
 *
 * @author leolu
 */
public enum ArchitectureReviewStatus {
    /** 模型建议已生成。 */
    COMPLETED,
    /** LLM 未启用。 */
    DISABLED,
    /** 指标已收集，但模型调用失败。 */
    FAILED
}
