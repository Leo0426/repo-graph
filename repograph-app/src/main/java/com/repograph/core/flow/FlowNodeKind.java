package com.repograph.core.flow;

/**
 * 函数内流图节点类型。
 *
 * @author leolu
 */
public enum FlowNodeKind {
    ENTRY,
    EXIT,
    STATEMENT,
    CONDITION,
    RETURN,
    THROW,
    /** catch 子句入口节点。 */
    CATCH,
    /** finally 块入口节点。 */
    FINALLY
}
