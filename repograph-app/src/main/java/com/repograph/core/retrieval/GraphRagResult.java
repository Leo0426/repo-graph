package com.repograph.core.retrieval;

import java.util.List;

/**
 * GraphRAG 检索结果，包含排序后的代码单元列表及本次检索统计。
 *
 * @param results               按 finalScore 降序排列的结果列表
 * @param seedCount             向量检索种子数量
 * @param keywordSeedCount      关键词检索种子数量
 * @param callGraphExpanded     调用图展开新增的结果数量
 * @param impactExpanded        影响面扩展新增的结果数量（仅安全相关节点）
 * @param securityHighlightCount securityScore &gt; 0.3 的高安全敏感结果数量
 * @author leolu
 */
public record GraphRagResult(
        List<RankedUnit> results,
        int seedCount,
        int keywordSeedCount,
        int callGraphExpanded,
        int impactExpanded,
        int securityHighlightCount
) {
    /**
     * 兼容旧调用点的构造器，默认无关键词种子。
     *
     * @param results                排序结果
     * @param seedCount              向量种子数量
     * @param callGraphExpanded      调用图扩展数量
     * @param impactExpanded         影响面扩展数量
     * @param securityHighlightCount 安全高亮数量
     */
    public GraphRagResult(List<RankedUnit> results, int seedCount, int callGraphExpanded,
                          int impactExpanded, int securityHighlightCount) {
        this(results, seedCount, 0, callGraphExpanded, impactExpanded, securityHighlightCount);
    }
}
