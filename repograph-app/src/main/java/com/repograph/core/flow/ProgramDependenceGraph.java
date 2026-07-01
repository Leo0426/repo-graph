package com.repograph.core.flow;

import java.util.List;

/**
 * 由控制依赖与数据依赖组合成的轻量程序依赖图。
 *
 * @param nodes 与 CFG 共用的函数内节点
 * @param edges 数据依赖和控制依赖边
 * @author leolu
 */
public record ProgramDependenceGraph(List<FlowNode> nodes, List<FlowEdge> edges) {}
