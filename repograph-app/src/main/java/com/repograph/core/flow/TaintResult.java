package com.repograph.core.flow;

import java.util.List;

/**
 * 跨过程污点分析结果。
 *
 * @param sourceMethod     污点源方法全限定名
 * @param sourceParamIndex 污点源参数下标（0-based）
 * @param paths            发现的污点路径列表
 * @param methodsAnalyzed  实际分析的方法数量
 * @param truncated        是否因达到深度/路径上限而提前终止
 */
public record TaintResult(
        String sourceMethod,
        int sourceParamIndex,
        List<TaintPath> paths,
        int methodsAnalyzed,
        boolean truncated
) {}
