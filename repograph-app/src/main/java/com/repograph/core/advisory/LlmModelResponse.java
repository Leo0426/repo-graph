package com.repograph.core.advisory;

import com.repograph.core.finding.TriageVerdict;

import java.util.List;

/**
 * 模型适配器返回的结构化建议。
 *
 * @param suggestedVerdict 建议结论
 * @param uncertainty      不确定度 [0, 1]
 * @param citations        模型引用的 citation ID
 * @param missingInfo      模型声明的缺失信息
 * @param usage            token 与成本摘要
 * @author leolu
 */
public record LlmModelResponse(
        TriageVerdict suggestedVerdict,
        float uncertainty,
        List<String> citations,
        List<String> missingInfo,
        LlmUsage usage
) {
    /**
     * 创建不可变模型响应。
     */
    public LlmModelResponse {
        if (uncertainty < 0.0f || uncertainty > 1.0f) {
            throw new IllegalArgumentException("uncertainty must be between 0 and 1");
        }
        citations = List.copyOf(citations);
        missingInfo = List.copyOf(missingInfo);
        usage = usage == null ? LlmUsage.NONE : usage;
    }
}
