package com.repograph.core.finding;

import java.time.Instant;
import java.time.format.DateTimeParseException;

/**
 * 有作用域、有效期和审计身份的规则抑制策略。
 *
 * @param id         策略标识
 * @param projectId  项目标识
 * @param ruleId     外部规则标识
 * @param scope      作用域
 * @param scopeValue FILE_GLOB 的 glob；PROJECT 时为空
 * @param reason     创建理由
 * @param createdBy  创建人
 * @param createdAt  创建时间
 * @param expiresAt  过期时间
 * @param active     是否尚未被撤销
 * @author leolu
 */
public record RuleSuppression(
        String id,
        String projectId,
        String ruleId,
        RuleSuppressionScope scope,
        String scopeValue,
        String reason,
        String createdBy,
        String createdAt,
        String expiresAt,
        boolean active
) {
    /**
     * 创建规则抑制并校验审计字段及有效期。
     */
    public RuleSuppression {
        id = requireText(id, "id");
        projectId = requireText(projectId, "projectId");
        ruleId = requireText(ruleId, "ruleId");
        if (scope == null) {
            throw new IllegalArgumentException("scope must not be null");
        }
        scopeValue = scopeValue == null ? "" : scopeValue.trim().replace('\\', '/');
        if (scope == RuleSuppressionScope.FILE_GLOB && scopeValue.isBlank()) {
            throw new IllegalArgumentException("scopeValue is required for FILE_GLOB");
        }
        reason = requireText(reason, "reason");
        createdBy = requireText(createdBy, "createdBy");
        createdAt = requireText(createdAt, "createdAt");
        expiresAt = requireText(expiresAt, "expiresAt");
        Instant created = parseInstant(createdAt, "createdAt");
        Instant expires = parseInstant(expiresAt, "expiresAt");
        if (!expires.isAfter(created)) {
            throw new IllegalArgumentException("expiresAt must be after createdAt");
        }
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value.trim();
    }

    private static Instant parseInstant(String value, String field) {
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException(field + " must be an ISO-8601 instant", e);
        }
    }
}
