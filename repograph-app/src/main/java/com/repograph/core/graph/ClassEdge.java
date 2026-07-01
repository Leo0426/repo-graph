package com.repograph.core.graph;

/**
 * 跨类调用边，表示一个类的方法调用了另一个类的方法。
 *
 * <p>用于计算类级别的耦合度指标（fan-in / fan-out）。
 *
 * @param callerClass 调用方所属类的全限定名（{@code qualifiedName} 中 {@code #} 之前的部分）
 * @param calleeClass 被调用方所属类的全限定名
 * @author leolu
 * @since 0.6.0
 */
public record ClassEdge(String callerClass, String calleeClass) {}
