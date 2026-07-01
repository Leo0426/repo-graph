package com.repograph.core.flow;

/**
 * 单个方法内的污点传播边：从一个数据位置流向另一个。
 */
public record TaintEdge(TaintSlot from, TaintSlot to) {}
