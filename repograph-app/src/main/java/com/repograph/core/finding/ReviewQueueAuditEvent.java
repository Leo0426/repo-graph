package com.repograph.core.finding;

/**
 * 审核队列条目的审计事件。
 *
 * @param id         事件标识
 * @param entryId    队列条目标识
 * @param action     SUBMITTED、CLAIMED、RETURNED、CONFIRMED 或 REJECTED
 * @param actor      操作人
 * @param reason     操作理由
 * @param occurredAt 事件时间
 * @author leolu
 */
public record ReviewQueueAuditEvent(
        String id,
        String entryId,
        String action,
        String actor,
        String reason,
        String occurredAt
) {}
