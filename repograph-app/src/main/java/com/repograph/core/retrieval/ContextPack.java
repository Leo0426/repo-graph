package com.repograph.core.retrieval;

import java.util.List;

/**
 * 面向 LLM Agent 的可溯源上下文包。
 *
 * @param query              原始查询
 * @param taskType           任务类型，如 {@code detail}、{@code security}、{@code summary}
 * @param evidence           已纳入预算的上下文证据
 * @param omittedReasons     未纳入或被裁剪的原因说明
 * @param requestedBudgetChars 请求的字符预算
 * @param usedBudgetChars    实际使用字符数
 * @param seedCount          GraphRAG 向量种子数量
 * @param keywordSeedCount   GraphRAG 关键词种子数量
 * @param callGraphExpanded  调用图扩展数量
 * @param impactExpanded     影响面扩展数量
 * @author leolu
 */
public record ContextPack(
        String query,
        String taskType,
        List<ContextEvidence> evidence,
        List<String> omittedReasons,
        int requestedBudgetChars,
        int usedBudgetChars,
        int seedCount,
        int keywordSeedCount,
        int callGraphExpanded,
        int impactExpanded
) {
    /**
     * 兼容旧调用点的构造器，默认无关键词种子。
     */
    public ContextPack(String query, String taskType, List<ContextEvidence> evidence,
                       List<String> omittedReasons, int requestedBudgetChars, int usedBudgetChars,
                       int seedCount, int callGraphExpanded, int impactExpanded) {
        this(query, taskType, evidence, omittedReasons, requestedBudgetChars, usedBudgetChars,
                seedCount, 0, callGraphExpanded, impactExpanded);
    }
}
