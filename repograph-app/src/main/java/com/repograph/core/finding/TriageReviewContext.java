package com.repograph.core.finding;

/**
 * 一次研判所使用的项目版本和历史决策输入。
 *
 * @param projectId          当前项目标识
 * @param codeVersion        当前代码版本，如 commit SHA
 * @param ruleVersion        当前扫描规则版本
 * @param historicalFeedback 同项目同指纹的历史人工反馈；不存在时为 {@code null}
 * @param activeSuppression  当前匹配且未过期的规则抑制；不存在时为 {@code null}
 * @author leolu
 */
public record TriageReviewContext(
        String projectId,
        String codeVersion,
        String ruleVersion,
        TriageFeedback historicalFeedback,
        RuleSuppression activeSuppression
) {
    /**
     * 创建不带规则抑制的兼容上下文。
     *
     * @param projectId          项目标识
     * @param codeVersion        代码版本
     * @param ruleVersion        规则版本
     * @param historicalFeedback 历史反馈
     */
    public TriageReviewContext(
            String projectId,
            String codeVersion,
            String ruleVersion,
            TriageFeedback historicalFeedback) {
        this(projectId, codeVersion, ruleVersion, historicalFeedback, null);
    }

    /**
     * 创建研判输入并归一化可空字符串。
     */
    public TriageReviewContext {
        projectId = projectId == null ? "" : projectId.trim();
        codeVersion = codeVersion == null ? "" : codeVersion.trim();
        ruleVersion = ruleVersion == null ? "" : ruleVersion.trim();
    }

    /**
     * 返回不包含历史决策输入的默认上下文。
     *
     * @return 空研判上下文
     */
    public static TriageReviewContext empty() {
        return new TriageReviewContext("", "", "", null, null);
    }
}
