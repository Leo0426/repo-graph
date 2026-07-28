package com.repograph.core.authorization;

import java.util.List;

/**
 * 从路由入口沿调用图发现的资源访问或危险 Sink 证据。
 *
 * @param kind      DATABASE、FILE、NETWORK 或 DANGEROUS_SINK
 * @param target    命中的 API 或调用特征
 * @param callPath  从路由处理器到目标代码单元的有序调用路径
 * @param citations 与调用路径一一对应的源码引用
 * @author leolu
 */
public record ResourceAccessEvidence(
        String kind,
        String target,
        List<String> callPath,
        List<SourceCitation> citations
) {
    /**
     * 创建不可变资源访问证据。
     */
    public ResourceAccessEvidence {
        callPath = List.copyOf(callPath);
        citations = List.copyOf(citations);
    }
}
