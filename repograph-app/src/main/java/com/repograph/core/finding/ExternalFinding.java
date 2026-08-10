package com.repograph.core.finding;

import java.util.List;
import java.util.Objects;

/**
 * SAST / SCA 报警的统一研判输入模型。
 *
 * <p>该模型表示一次研判所需的不可变报警事实，
 * 用于后续报警解释、上下文构建和误报研判。
 * 外部工具输入由 importer 归一化；RepoGraph 内部 {@code VulnFinding} 由 Agent 入口适配，
 * 二者均不在运行记录中复制原始领域事实。
 *
 * @param tool      外部工具名称，如 {@code semgrep}、{@code codeql}、{@code sonarqube}
 * @param ruleId    外部规则 ID，如 {@code java.lang.security.audit.command-injection}
 * @param cwe       CWE 编号，如 {@code CWE-78}；外部工具未提供时为空字符串
 * @param severity  归一化严重程度
 * @param message   外部工具报警信息
 * @param filePath  项目内相对文件路径
 * @param startLine 报警起始行号，1-based
 * @param endLine   报警结束行号，1-based
 * @param symbol    外部工具识别到的函数、方法或符号名；未知时为空字符串
 * @param trace     外部工具提供的数据流、调用路径或证据步骤；没有路径时为空列表
 * @param raw       原始报警 JSON 片段或工具输出片段；未知时为空字符串
 * @author leolu
 */
public record ExternalFinding(
        String tool,
        String ruleId,
        String cwe,
        ExternalFindingSeverity severity,
        String message,
        String filePath,
        int startLine,
        int endLine,
        String symbol,
        List<ExternalFindingTraceStep> trace,
        String raw
) {
    /**
     * 创建外部报警并校验必填字段。
     */
    public ExternalFinding {
        tool = requireText(tool, "tool");
        ruleId = requireText(ruleId, "ruleId");
        cwe = cwe == null ? "" : cwe.trim();
        severity = severity == null ? ExternalFindingSeverity.UNKNOWN : severity;
        message = requireText(message, "message");
        filePath = requireText(filePath, "filePath");
        if (startLine <= 0) {
            throw new IllegalArgumentException("startLine must be positive");
        }
        if (endLine <= 0) {
            endLine = startLine;
        }
        if (endLine < startLine) {
            throw new IllegalArgumentException("endLine must be >= startLine");
        }
        symbol = symbol == null ? "" : symbol.trim();
        trace = List.copyOf(Objects.requireNonNullElse(trace, List.of()));
        raw = raw == null ? "" : raw;
    }

    /**
     * 计算报警指纹 {@code SHA256(tool|ruleId|filePath|startLine)[:16]}，
     * 用于跨导入批次关联同一条报警（如反馈记录）。
     *
     * @return 16 位十六进制指纹
     */
    public String fingerprint() {
        try {
            var digest = java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(
                    (tool + '|' + ruleId + '|' + filePath + '|' + startLine)
                            .getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < 8; i++) {
                hex.append(String.format("%02x", hash[i]));
            }
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value.trim();
    }
}
