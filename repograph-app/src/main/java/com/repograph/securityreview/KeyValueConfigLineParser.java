package com.repograph.securityreview;

import java.util.ArrayList;
import java.util.List;

/**
 * key-value 风格配置行解析器。
 *
 * <p>支持 {@code key value}、{@code key=value}、{@code key = value} 与带引号值
 * （{@code key "value"}）；跳过空行和 {@code #} 注释。该格式覆盖 sshd_config、login.defs、
 * sysctl.conf、auditd.conf 等常见主机配置文件。
 *
 * @author leolu
 */
final class KeyValueConfigLineParser {

    private KeyValueConfigLineParser() {
    }

    /**
     * 将配置文件内容解析为 key-value 行列表。
     *
     * @param content 文件原文
     * @return 解析结果；无有效行时为空列表
     */
    static List<ConfigLine> parse(String content) {
        List<ConfigLine> lines = new ArrayList<>();
        if (content == null || content.isBlank()) {
            return lines;
        }
        String[] rawLines = content.split("\r?\n");
        for (int i = 0; i < rawLines.length; i++) {
            String raw = stripInlineComment(rawLines[i]).trim();
            if (raw.isEmpty()) {
                continue;
            }
            ConfigLine line = parseLine(i + 1, raw);
            if (line != null) {
                lines.add(line);
            }
        }
        return lines;
    }

    private static ConfigLine parseLine(int lineNumber, String raw) {
        int eq = raw.indexOf('=');
        int space = indexOfSeparator(raw);
        if (eq > 0 && (space < 0 || eq < space)) {
            String key = raw.substring(0, eq).trim();
            String value = raw.substring(eq + 1).trim();
            return key.isEmpty() ? null : new ConfigLine(lineNumber, key, stripQuotes(value));
        }
        if (space > 0) {
            String key = raw.substring(0, space).trim();
            String value = raw.substring(space + 1).trim();
            // 处理 "key = value" 空格分隔分支吃掉等号的情况
            if (value.startsWith("=")) {
                value = value.substring(1).trim();
            }
            return key.isEmpty() ? null : new ConfigLine(lineNumber, key, stripQuotes(value));
        }
        return null;
    }

    private static int indexOfSeparator(String raw) {
        for (int i = 0; i < raw.length(); i++) {
            if (Character.isWhitespace(raw.charAt(i))) {
                return i;
            }
        }
        return -1;
    }

    private static String stripInlineComment(String raw) {
        int hash = raw.indexOf('#');
        return hash >= 0 ? raw.substring(0, hash) : raw;
    }

    private static String stripQuotes(String value) {
        if (value.length() >= 2 && ((value.startsWith("\"") && value.endsWith("\""))
                || (value.startsWith("'") && value.endsWith("'")))) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }
}
