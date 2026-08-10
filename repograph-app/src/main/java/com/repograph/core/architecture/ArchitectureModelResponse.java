package com.repograph.core.architecture;

import java.util.List;

/**
 * 架构评审模型的结构化响应。
 *
 * @param observations 架构观察
 * @param candidates   深化候选
 * @param missingInfo  缺失信息
 * @author leolu
 */
public record ArchitectureModelResponse(
        List<String> observations,
        List<ArchitectureReviewCandidate> candidates,
        List<String> missingInfo) {
}
