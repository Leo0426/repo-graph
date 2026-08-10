package com.repograph.core.architecture;

import java.util.function.Consumer;

/**
 * 架构漂移与变更风险评审接口。
 *
 * @author leolu
 */
public interface ArchitectureReviewService {

    /**
     * 从项目静态指标生成模型辅助架构建议。
     *
     * @param projectId 项目 ID
     * @return 可审计评审结果
     */
    ArchitectureReviewResult review(String projectId);

    /**
     * 流式生成架构建议。
     *
     * @param projectId     项目 ID
     * @param deltaConsumer 模型公开输出增量接收器
     * @return 可审计评审结果
     */
    ArchitectureReviewResult reviewStreaming(String projectId, Consumer<String> deltaConsumer);
}
