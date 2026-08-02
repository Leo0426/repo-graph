package com.repograph.core.finding;

/**
 * 检测规则生命周期迁移的不可变审计事件。
 *
 * @param id         事件标识
 * @param ruleId     规则标识
 * @param version    规则版本
 * @param action     操作类型
 * @param actor      操作者
 * @param reason     操作理由
 * @param occurredAt 发生时间
 * @author leolu
 */
public record RuleAuditEvent(
        String id,
        String ruleId,
        int version,
        String action,
        String actor,
        String reason,
        String occurredAt) {
}
