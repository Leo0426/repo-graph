package com.repograph.core.flow;

import java.util.List;

/**
 * 按需生成的函数内控制流图。
 *
 * @param nodes CFG 节点
 * @param edges CFG 控制边
 * @author leolu
 */
public record ControlFlowGraph(List<FlowNode> nodes, List<FlowEdge> edges) {}
