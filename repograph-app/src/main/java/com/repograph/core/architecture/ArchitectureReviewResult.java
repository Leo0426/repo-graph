package com.repograph.core.architecture;

import java.util.List;

/**
 * 可审计的架构评审结果。
 *
 * @param projectId    项目 ID
 * @param status       模型评审状态
 * @param methodology  方法论版本
 * @param model        模型标识
 * @param generatedAt  生成时间
 * @param observations 架构观察
 * @param candidates   深化候选
 * @param missingInfo  缺失信息或降级原因
 * @param evidence     输入事实
 * @author leolu
 */
public record ArchitectureReviewResult(
        String projectId,
        ArchitectureReviewStatus status,
        String methodology,
        String model,
        String generatedAt,
        List<String> observations,
        List<ArchitectureReviewCandidate> candidates,
        List<String> missingInfo,
        List<ArchitectureEvidence> evidence) {
}
