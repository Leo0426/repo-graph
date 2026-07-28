package com.repograph.core.finding;

/**
 * 用户对单条外部报警研判结果的反馈记录。
 *
 * @param fingerprint 外部报警指纹，见 {@link ExternalFinding#fingerprint()}
 * @param projectId   报警所属项目 ID
 * @param status      反馈状态
 * @param reviewer    反馈人标识；未知时为空字符串
 * @param reason      反馈理由；未提供时为空字符串
 * @param codeVersion 反馈对应的代码版本；未知时为空字符串
 * @param ruleVersion 反馈对应的规则版本；未知时为空字符串
 * @param updatedAt   最近更新时间，ISO-8601 字符串
 * @author leolu
 */
public record TriageFeedback(
        String fingerprint,
        String projectId,
        TriageFeedbackStatus status,
        String reviewer,
        String reason,
        String codeVersion,
        String ruleVersion,
        String updatedAt
) {
    /**
     * 创建不带版本的兼容反馈记录。
     *
     * <p>缺少版本的历史反馈可以查询和展示，但不会自动改变后续研判结论。
     *
     * @param fingerprint 外部报警指纹
     * @param projectId   项目标识
     * @param status      反馈状态
     * @param reviewer    反馈人
     * @param reason      反馈理由
     * @param updatedAt   更新时间
     */
    public TriageFeedback(
            String fingerprint,
            String projectId,
            TriageFeedbackStatus status,
            String reviewer,
            String reason,
            String updatedAt) {
        this(fingerprint, projectId, status, reviewer, reason, "", "", updatedAt);
    }

    /**
     * 创建反馈记录并校验必填字段。
     */
    public TriageFeedback {
        if (fingerprint == null || fingerprint.isBlank()) {
            throw new IllegalArgumentException("fingerprint must not be blank");
        }
        if (projectId == null || projectId.isBlank()) {
            throw new IllegalArgumentException("projectId must not be blank");
        }
        if (status == null) {
            throw new IllegalArgumentException("status must not be null");
        }
        if (updatedAt == null || updatedAt.isBlank()) {
            throw new IllegalArgumentException("updatedAt must not be blank");
        }
        fingerprint = fingerprint.trim();
        projectId = projectId.trim();
        reviewer = reviewer == null ? "" : reviewer.trim();
        reason = reason == null ? "" : reason.trim();
        codeVersion = codeVersion == null ? "" : codeVersion.trim();
        ruleVersion = ruleVersion == null ? "" : ruleVersion.trim();
        updatedAt = updatedAt.trim();
    }
}
