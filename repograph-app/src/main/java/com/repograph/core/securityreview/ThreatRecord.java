package com.repograph.core.securityreview;

/**
 * 单条威胁记录。
 *
 * @param ruleId     命中的检测规则 ID
 * @param kind       威胁类型
 * @param severity   严重程度
 * @param time       事件时间原文（从日志行提取）；无法提取时为 null
 * @param logFile    日志文件名（调用方提供的相对名）
 * @param lineNumber 日志行号（1-based）
 * @param evidence   命中日志行原文
 * @param detail     威胁说明
 * @author leolu
 */
public record ThreatRecord(
        String ruleId,
        ThreatKind kind,
        AuditSeverity severity,
        String time,
        String logFile,
        int lineNumber,
        String evidence,
        String detail) {
}
