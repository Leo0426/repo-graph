package com.repograph.core.securityreview;

/**
 * 单条配置核查违规项。
 *
 * @param ruleId      命中的规则 ID
 * @param dimension   核查维度
 * @param severity    严重程度
 * @param filePath    违规配置文件名（调用方提供的相对名）
 * @param lineNumber  违规行号（1-based）；键缺失类违规为 null
 * @param evidence    违规证据描述（原文或缺失说明）
 * @param basis       依据条款
 * @param remediation 整改建议
 * @author leolu
 */
public record ConfigViolation(
        String ruleId,
        AuditDimension dimension,
        AuditSeverity severity,
        String filePath,
        Integer lineNumber,
        String evidence,
        String basis,
        String remediation) {
}
