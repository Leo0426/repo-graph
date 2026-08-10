package com.repograph.core.architecture;

import java.util.List;

/**
 * 发送给架构评审模型的受约束事实包。
 *
 * @param projectId   项目 ID
 * @param projectRoot 项目根目录
 * @param generatedAt 指标快照生成时间
 * @param healthScore 健康分
 * @param evidence    可引用事实
 * @author leolu
 */
public record ArchitectureReviewInput(
        String projectId,
        String projectRoot,
        String generatedAt,
        int healthScore,
        List<ArchitectureEvidence> evidence) {
}
