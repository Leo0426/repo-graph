package com.repograph.wiki;

import com.repograph.core.wiki.SummaryDocument;

import java.util.List;

/**
 * 一次分层摘要生成的结果（含 LLM 通道可观测信息）。
 *
 * @param documents     持久化后的全部摘要文档
 * @param factsHash     结构事实指纹（缓存键的一部分）
 * @param llmRequested  本次是否要求 LLM 架构摘要
 * @param llmUsed       LLM 通道是否实际参与（可用且至少一个章节生成/命中缓存）
 * @param model         使用的模型名称；未使用 LLM 时为 {@code null}
 * @param missingInfo   LLM 章节失败、非法引用被丢弃等信息
 * @author leolu
 * @since 0.7.0
 */
public record SummaryGenerationOutcome(
        List<SummaryDocument> documents,
        String factsHash,
        boolean llmRequested,
        boolean llmUsed,
        String model,
        List<String> missingInfo
) {

    public SummaryGenerationOutcome {
        if (documents == null) documents = List.of();
        if (missingInfo == null) missingInfo = List.of();
        documents = List.copyOf(documents);
        missingInfo = List.copyOf(missingInfo);
    }
}
