package com.repograph.core.flow;

import java.util.List;

/**
 * 单个方法的方法内污点摘要：描述参数如何流向调用位置参数、返回值和 Sink。
 *
 * <p>使用流不敏感（flow-insensitive）保守近似——忽略控制流顺序，避免漏报。
 *
 * @param methodQn 方法全限定名
 * @param params   方法参数名列表（顺序即 param[i] 的 i）
 * @param edges    污点传播边集合
 */
public record MethodTaintSummary(
        String methodQn,
        List<String> params,
        List<TaintEdge> edges
) {}
