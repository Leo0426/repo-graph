package com.repograph.core.flow;

/**
 * 单个方法或函数的按需流分析结果。
 *
 * @param target                 目标符号 qualifiedName
 * @param language               语言标识
 * @param summary                方法级数据流摘要
 * @param controlFlowGraph       函数内 CFG
 * @param programDependenceGraph 轻量 PDG
 * @param precise                是否由精确 AST 分析产生
 * @author leolu
 */
public record FlowAnalysisResult(
        String target,
        String language,
        DataFlowSummary summary,
        ControlFlowGraph controlFlowGraph,
        ProgramDependenceGraph programDependenceGraph,
        boolean precise
) {}
