package com.repograph.core.flow;

/**
 * 函数内流图节点，不作为长期 {@code CodeUnit} 持久化。
 *
 * @param id    分析结果内稳定的局部节点 ID
 * @param kind  节点类型
 * @param label 精简源码标签
 * @param line  源文件绝对行号，1-based
 * @author leolu
 */
public record FlowNode(String id, FlowNodeKind kind, String label, int line) {}
