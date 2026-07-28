package com.repograph.core.advisory;

/**
 * LLM 辅助复核的受控执行状态。
 *
 * @author leolu
 */
public enum LlmAdvisoryStatus {

    /** 模型能力未启用，完全保留启发式报告。 */
    DISABLED,

    /** 模型返回的结构化建议已通过边界校验。 */
    COMPLETED,

    /** 模型执行超时。 */
    TIMED_OUT,

    /** 输入或预计调用成本超过配置预算。 */
    BUDGET_EXCEEDED,

    /** 模型调用或输出校验失败。 */
    FAILED
}
