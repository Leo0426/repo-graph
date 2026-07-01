package com.repograph.core.flow;

/**
 * 跨过程污点分析：从指定方法参数出发，沿调用图传播，发现可达 Sink。
 */
public interface TaintAnalysisService {

    /**
     * 分析从指定参数出发的跨过程污点传播路径。
     *
     * @param sourceMethodQn   污点源方法全限定名
     * @param sourceParamIndex 污点源参数下标（0-based）
     * @param projectId        可选项目 ID；为 null 时跨项目查询
     * @param maxDepth         最大调用深度（建议 5–10）
     * @return 分析结果，包含所有发现的污点路径
     */
    TaintResult analyzeTaint(String sourceMethodQn, int sourceParamIndex,
                             String projectId, int maxDepth);
}
