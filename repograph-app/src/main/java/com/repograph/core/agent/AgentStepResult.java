package com.repograph.core.agent;

/**
 * Agent 步骤对单个事实主体产生的公开决策结果。
 *
 * <p>该模型只保存可审计结论，不保存提示词、源码或模型思维链。
 *
 * @param subjectReference 领域事实引用，例如 {@code finding:<fingerprint>}
 * @param baseline         自动化基线结论
 * @param recommendation   辅助能力给出的建议结论；没有建议时为空
 * @param uncertainty      建议不确定度，范围为 [0, 1]
 * @param advisoryOnly     建议是否仅供人工参考
 * @author leolu
 */
public record AgentStepResult(
        String subjectReference,
        String baseline,
        String recommendation,
        float uncertainty,
        boolean advisoryOnly) {

    /**
     * 创建不可变的步骤决策结果。
     */
    public AgentStepResult {
        if (uncertainty < 0.0f || uncertainty > 1.0f) {
            throw new IllegalArgumentException("uncertainty must be between 0 and 1");
        }
        subjectReference = subjectReference == null ? "" : subjectReference;
        baseline = baseline == null ? "" : baseline;
        recommendation = recommendation == null ? "" : recommendation;
    }
}
