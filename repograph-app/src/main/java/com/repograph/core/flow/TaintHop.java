package com.repograph.core.flow;

/**
 * 跨过程污点路径中的单步：在哪个方法内、从哪个位置流向哪个位置。
 *
 * @param methodQn 当前方法全限定名
 * @param from     污点来源位置
 * @param to       污点目标位置
 */
public record TaintHop(String methodQn, TaintSlot from, TaintSlot to) {}
