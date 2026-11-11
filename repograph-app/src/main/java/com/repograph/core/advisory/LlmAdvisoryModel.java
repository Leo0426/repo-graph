package com.repograph.core.advisory;

/**
 * 提供方中立的 LLM 模型适配接口。
 *
 * @author leolu
 */
public interface LlmAdvisoryModel {

    /** Captures stable configuration for estimation, execution, retries and audit of one review. */
    default LlmAdvisoryModel forRequest() { return this; }

    /**
     * 返回模型当前是否可用。
     *
     * @return 可用时为 {@code true}
     */
    boolean available();

    /**
     * 返回提供方标识。
     *
     * @return 提供方标识
     */
    String provider();

    /**
     * 返回模型标识。
     *
     * @return 模型标识
     */
    String model();

    /**
     * 在实际调用前估算最大成本。
     *
     * @param inputChars    输入字符数
     * @param maxOutputChars 最大输出字符数
     * @return 估算美元成本；未知价格返回 NaN，允许在输入/输出及超时限制内调用
     */
    double estimateCostUsd(int inputChars, int maxOutputChars);

    /** Estimates a prepared request; implementations may include serialized metadata and protocol overhead. */
    default double estimateCostUsd(LlmAdvisoryRequest request) {
        int characters = request.findingSummary().length()
                + request.evidence().stream().mapToInt(evidence -> evidence.excerpt().length()).sum()
                + request.missingInfo().stream().mapToInt(String::length).sum();
        return estimateCostUsd(characters, request.maxOutputChars());
    }

    /**
     * 执行结构化辅助复核。
     *
     * @param request 受限请求
     * @return 结构化模型响应
     */
    LlmModelResponse review(LlmAdvisoryRequest request);
}
