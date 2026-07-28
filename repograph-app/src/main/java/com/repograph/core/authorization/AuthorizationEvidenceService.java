package com.repograph.core.authorization;

import java.util.List;

/**
 * 路由、鉴权约束和资源访问证据分析边界。
 *
 * @author leolu
 */
public interface AuthorizationEvidenceService {

    /**
     * 分析项目中的 HTTP 路由。
     *
     * @param projectId 项目标识
     * @param maxDepth  资源访问调用图最大遍历深度
     * @return 路由证据列表
     */
    List<AuthorizationEvidence> analyze(String projectId, int maxDepth);
}
