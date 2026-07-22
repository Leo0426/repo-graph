package com.repograph.core.retrieval;

/**
 * Context Pack 构建选项，复用 GraphRAG 检索参数并增加上下文预算。
 *
 * @param taskType    任务类型；为空时按 {@code detail} 处理
 * @param budgetChars 上下文片段总字符预算
 * @param graphRag    底层 GraphRAG 检索选项
 * @author leolu
 */
public record ContextPackOptions(
        String taskType,
        int budgetChars,
        GraphRagOptions graphRag
) {
    /**
     * 创建默认上下文组装选项。
     *
     * @return 默认选项
     */
    public static ContextPackOptions defaults() {
        return new ContextPackOptions("detail", 12000, GraphRagOptions.defaults());
    }
}
