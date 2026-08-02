package com.repograph.core.finding;

import java.util.List;

/**
 * 已注册的不可变检测规则版本。
 *
 * @param ruleId          稳定规则标识
 * @param version         单规则单调递增版本号
 * @param source          规则来源
 * @param languages       适用语言
 * @param frameworks      适用框架
 * @param cwe             CWE 标识
 * @param severity        严重程度
 * @param title           规则标题
 * @param matcherKind     matcher 类型
 * @param pattern         匹配表达式
 * @param status          生命周期状态
 * @param positiveSamples 必须命中的阳性样本
 * @param negativeSamples 必须不命中的阴性样本
 * @param changeNotes     版本变更说明
 * @param active          是否为当前生效版本
 * @param createdAt       创建时间
 * @param updatedAt       最后更新时间
 * @author leolu
 */
public record DetectionRule(
        String ruleId,
        int version,
        String source,
        List<String> languages,
        List<String> frameworks,
        String cwe,
        ExternalFindingSeverity severity,
        String title,
        RuleMatcherKind matcherKind,
        String pattern,
        RuleStatus status,
        List<String> positiveSamples,
        List<String> negativeSamples,
        String changeNotes,
        boolean active,
        String createdAt,
        String updatedAt) {

    /**
     * 冻结集合字段。
     */
    public DetectionRule {
        languages = List.copyOf(languages);
        frameworks = List.copyOf(frameworks);
        positiveSamples = List.copyOf(positiveSamples);
        negativeSamples = List.copyOf(negativeSamples);
    }
}
