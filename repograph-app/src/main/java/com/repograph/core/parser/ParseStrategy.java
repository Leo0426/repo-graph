package com.repograph.core.parser;

/**
 * 解析策略枚举，控制解析器的选择与降级行为。
 *
 * @author leolu
 * @since 0.1.0
 */
public enum ParseStrategy {

    /** 直接调用精确解析器（JavaParser 或 Tree-sitter），不降级。 */
    PRECISE,

    /** 直接调用启发式解析器（状态机），不尝试精确解析。 */
    HEURISTIC,

    /**
     * 自动策略（默认）：优先使用精确解析器；若解析失败或结果为空，
     * 自动降级为启发式解析器并记录降级日志。
     */
    AUTO
}
