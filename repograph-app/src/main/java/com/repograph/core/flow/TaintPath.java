package com.repograph.core.flow;

import java.util.List;

/**
 * 从污点源到 Sink（或路径终止点）的完整跨过程传播链。
 *
 * @param hops            调用跳链，每跳记录方法内的流转边
 * @param reachesSink     是否命中已知 Sink
 * @param sinkDescription Sink 描述（reachesSink 为 true 时有值），格式：{@code "SINK:method.arg[i]"}
 */
public record TaintPath(List<TaintHop> hops, boolean reachesSink, String sinkDescription) {}
