package com.repograph.core.securityreview;

/**
 * 配置核查规则。
 *
 * <p>规则以 JSON 数据形式维护（classpath {@code security-review/rules/}），新增规则不需要修改核查引擎。
 * {@code basis} 记录核查依据条款，违规时随报告输出，保证结论可追溯。
 *
 * @param ruleId      规则唯一 ID
 * @param dimension   所属核查维度
 * @param name        规则名称
 * @param basis       依据条款描述
 * @param severity    违规严重程度
 * @param remediation 整改建议
 * @param matcher     匹配器规格
 * @author leolu
 */
public record ConfigAuditRule(
        String ruleId,
        AuditDimension dimension,
        String name,
        String basis,
        AuditSeverity severity,
        String remediation,
        ConfigRuleMatcher matcher) {
}
