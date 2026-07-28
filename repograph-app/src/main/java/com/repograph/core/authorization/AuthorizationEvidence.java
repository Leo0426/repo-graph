package com.repograph.core.authorization;

import java.util.List;

/**
 * 单个 HTTP 路由的鉴权与资源访问证据快照。
 *
 * @param projectId       项目标识
 * @param route           路由证据
 * @param status          当前静态鉴权证据状态
 * @param constraints     类、方法或配置级约束候选
 * @param resourceAccesses 沿调用图发现的资源访问
 * @param missingInfo     无法通过当前静态分析确认的信息
 * @author leolu
 */
public record AuthorizationEvidence(
        String projectId,
        RouteEvidence route,
        AuthorizationEvidenceStatus status,
        List<AuthorizationConstraint> constraints,
        List<ResourceAccessEvidence> resourceAccesses,
        List<String> missingInfo
) {
    /**
     * 创建不可变证据快照。
     */
    public AuthorizationEvidence {
        constraints = List.copyOf(constraints);
        resourceAccesses = List.copyOf(resourceAccesses);
        missingInfo = List.copyOf(missingInfo);
    }
}
