package com.repograph.core.finding;

/**
 * 用户对单条外部报警研判结果的反馈记录。
 *
 * @param fingerprint 外部报警指纹，见 {@link ExternalFinding#fingerprint()}
 * @param projectId   报警所属项目 ID
 * @param status      反馈状态
 * @param reviewer    反馈人标识；未知时为空字符串
 * @param reason      反馈理由；未提供时为空字符串
 * @param updatedAt   最近更新时间，ISO-8601 字符串
 * @author leolu
 */
public record TriageFeedback(
        String fingerprint,
        String projectId,
        TriageFeedbackStatus status,
        String reviewer,
        String reason,
        String updatedAt
) {
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
        updatedAt = updatedAt.trim();
    }
}
