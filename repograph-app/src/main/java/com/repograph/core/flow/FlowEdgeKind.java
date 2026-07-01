package com.repograph.core.flow;

/**
 * 函数内控制流与程序依赖边类型。
 *
 * @author leolu
 */
public enum FlowEdgeKind {
    NEXT,
    TRUE_BRANCH,
    FALSE_BRANCH,
    LOOP_BACK,
    /** switch 语句 case 分支（传统冒号语法和增强箭头语法均使用）。 */
    CASE_BRANCH,
    /** try 块到 catch 子句的保守异常边（从 try 体首节点出发）。 */
    EXCEPTION_BRANCH,
    DATA_DEPENDENCY,
    CONTROL_DEPENDENCY
}
