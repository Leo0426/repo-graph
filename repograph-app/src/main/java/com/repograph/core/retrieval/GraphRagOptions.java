package com.repograph.core.retrieval;

/**
 * GraphRAG 检索选项，控制种子数量、图展开深度、各检索策略开关及安全重排序。
 *
 * @param seedLimit   向量检索种子数量（default 10，上限 20）
 * @param graphDepth  调用图展开深度（default 1，上限 3）
 * @param callGraph   是否开启调用图检索（callers + callees 展开）
 * @param impactExpansion 是否开启影响面扩展（仅加入安全相关节点）
 * @param rerank      是否应用安全感知重排序
 * @param projectId   可选项目 ID 过滤
 * @param lang        可选语言过滤（java / c / python）
 * @param noTest      为 {@code true} 时排除测试代码
 * @author leolu
 */
public record GraphRagOptions(
        int seedLimit,
        int graphDepth,
        boolean callGraph,
        boolean impactExpansion,
        boolean rerank,
        String projectId,
        String lang,
        boolean noTest
) {
    /**
     * 返回默认 GraphRAG 检索选项。
     *
     * @return 默认选项
     */
    public static GraphRagOptions defaults() {
        return new GraphRagOptions(10, 1, true, true, true, null, null, true);
    }
}
