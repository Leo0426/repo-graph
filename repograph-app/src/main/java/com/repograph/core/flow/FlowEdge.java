package com.repograph.core.flow;

/**
 * 函数内控制流或程序依赖边。
 *
 * @param sourceId 源流节点 ID
 * @param targetId 目标流节点 ID
 * @param kind     边类型
 * @param symbol   数据依赖对应的变量/字段名；控制边为空字符串
 * @author leolu
 */
public record FlowEdge(String sourceId, String targetId, FlowEdgeKind kind, String symbol) {}
