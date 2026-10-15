package com.repograph.wiki;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 分层摘要提示词脱敏器。
 *
 * <p>正则与 advisory 的 LLM 脱敏保持同一策略（password/secret/token/api-key 赋值与
 * Bearer token），对进入模型提示词的文本无条件执行（分层摘要输入以符号名与统计为主，
 * 此处为纵深防御）。与 advisory 的红act实现暂不合并：advisory 版本绑定其可配置开关
 * 与 RedactedText 类型，待 S3 统一治理。
 *
 * @author leolu
 * @since 0.7.0
 */
final class WikiPromptSanitizer {

    private static final Pattern SECRET_ASSIGNMENT = Pattern.compile(
            "(?i)(password|passwd|secret|token|api[_-]?key)\\s*[:=]\\s*(\"[^\"]*\"|'[^']*'|[^\\s;,]+)");
    private static final Pattern BEARER_TOKEN = Pattern.compile("(?i)bearer\\s+[a-z0-9._~+/=-]+");
    private static final String REDACTED = "[REDACTED]";

    private WikiPromptSanitizer() {
    }

    /**
     * 对提示词文本执行无条件脱敏。
     *
     * @param value 原始文本
     * @return 脱敏后的文本；输入为 {@code null} 时返回空字符串
     */
    static String redact(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        value = replaceAll(SECRET_ASSIGNMENT, value, "$1=" + REDACTED);
        return replaceAll(BEARER_TOKEN, value, "Bearer " + REDACTED);
    }

    private static String replaceAll(Pattern pattern, String value, String replacement) {
        Matcher matcher = pattern.matcher(value);
        StringBuilder result = new StringBuilder();
        while (matcher.find()) {
            matcher.appendReplacement(result, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(result);
        return result.toString();
    }
}
