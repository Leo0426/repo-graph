package com.repograph.core.finding;

import java.util.List;

/**
 * 创建检测规则候选时提交的统一元数据和回归样本。
 *
 * @param ruleId          稳定规则标识
 * @param source          规则来源
 * @param languages       适用语言
 * @param frameworks      适用框架
 * @param cwe             CWE 标识
 * @param severity        严重程度
 * @param title           规则标题
 * @param matcherKind     matcher 类型
 * @param pattern         匹配表达式
 * @param positiveSamples 必须命中的阳性样本
 * @param negativeSamples 必须不命中的阴性样本
 * @param changeNotes     版本变更说明
 * @author leolu
 */
public record DetectionRuleDraft(
        String ruleId,
        String source,
        List<String> languages,
        List<String> frameworks,
        String cwe,
        ExternalFindingSeverity severity,
        String title,
        RuleMatcherKind matcherKind,
        String pattern,
        List<String> positiveSamples,
        List<String> negativeSamples,
        String changeNotes) {

    /**
     * 校验并冻结规则候选输入。
     */
    public DetectionRuleDraft {
        ruleId = requireText(ruleId, "ruleId");
        source = requireText(source, "source");
        languages = copyNonBlank(languages, "languages");
        frameworks = frameworks == null || frameworks.isEmpty()
                ? List.of()
                : copyNonBlank(frameworks, "frameworks");
        cwe = requireText(cwe, "cwe");
        if (severity == null) {
            throw new IllegalArgumentException("severity is required");
        }
        title = requireText(title, "title");
        if (matcherKind == null) {
            throw new IllegalArgumentException("matcherKind is required");
        }
        pattern = requireText(pattern, "pattern");
        positiveSamples = copySamples(positiveSamples, "positiveSamples");
        negativeSamples = copySamples(negativeSamples, "negativeSamples");
        changeNotes = requireText(changeNotes, "changeNotes");
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value.trim();
    }

    private static List<String> copyNonBlank(List<String> values, String field) {
        if (values == null || values.isEmpty() || values.stream().anyMatch(value -> value == null || value.isBlank())) {
            throw new IllegalArgumentException(field + " must contain non-blank values");
        }
        return List.copyOf(values);
    }

    private static List<String> copySamples(List<String> values, String field) {
        if (values == null || values.isEmpty() || values.stream().anyMatch(value -> value == null || value.isEmpty())) {
            throw new IllegalArgumentException(field + " must contain samples");
        }
        return List.copyOf(values);
    }
}
