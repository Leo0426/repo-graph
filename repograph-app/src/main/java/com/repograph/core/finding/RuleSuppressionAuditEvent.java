package com.repograph.core.finding;

/**
 * 规则抑制策略的审计事件。
 *
 * @param id            事件标识
 * @param suppressionId 策略标识
 * @param action        CREATED 或 REVOKED
 * @param actor         操作人
 * @param reason        操作理由
 * @param occurredAt    事件时间
 * @author leolu
 */
public record RuleSuppressionAuditEvent(
        String id,
        String suppressionId,
        String action,
        String actor,
        String reason,
        String occurredAt
) {}
