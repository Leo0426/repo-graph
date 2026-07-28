package com.repograph.core.advisory;

/**
 * 模型调用资源消耗摘要，不包含提示词或源码。
 *
 * @param inputTokens     输入 token 数
 * @param outputTokens    输出 token 数
 * @param estimatedCostUsd 估算美元成本
 * @author leolu
 */
public record LlmUsage(int inputTokens, int outputTokens, double estimatedCostUsd) {

    /** 无模型调用时的零消耗。 */
    public static final LlmUsage NONE = new LlmUsage(0, 0, 0.0d);

    /**
     * 创建资源消耗摘要。
     */
    public LlmUsage {
        if (inputTokens < 0 || outputTokens < 0 || estimatedCostUsd < 0.0d) {
            throw new IllegalArgumentException("LLM usage values must not be negative");
        }
    }
}
