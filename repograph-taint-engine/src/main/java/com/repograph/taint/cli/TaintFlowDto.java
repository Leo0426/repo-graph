package com.repograph.taint.cli;

/**
 * 一条污点流的结构化结果,作为引擎独立进程输出契约的元素。
 * 字段刻意保持扁平字符串/整数,便于 JSON 序列化与跨进程传递给 repograph-app。
 *
 * @param ruleName        规则名(如 CWE_78)
 * @param sourceSignature 污点源方法签名
 * @param sinkSignature   Sink 方法签名
 * @param sinkClass       Sink 所在类(内部名,如 Ljava/lang/Runtime)
 * @param sourceLine      源位置行号(取不到为 -1)
 * @param detail          人类可读的路径描述
 */
public record TaintFlowDto(
    String ruleName,
    String sourceSignature,
    String sinkSignature,
    String sinkClass,
    int sourceLine,
    String detail
) {}
