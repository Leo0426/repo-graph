package com.repograph.vuln;

/**
 * 代码漏洞发现记录，由规则引擎扫描 CodeUnit 后生成，持久化于 SQLite {@code vuln_findings} 表。
 *
 * <p>状态机：{@code SUSPECTED → CONFIRMED → FIXED / DISMISSED}
 * <ul>
 *   <li>{@code SUSPECTED}  — 规则命中，待人工确认</li>
 *   <li>{@code CONFIRMED}  — 已人工确认为真实漏洞</li>
 *   <li>{@code FIXED}      — 已修复</li>
 *   <li>{@code DISMISSED}  — 误报，已忽略</li>
 * </ul>
 *
 * @param id           全局唯一 ID，{@code SHA256(projectId + ruleId + unitId)[:16]}
 * @param projectId    所属项目
 * @param ruleId       触发规则，如 {@code SQL_INJECTION}
 * @param cwe          CWE 编号，如 {@code CWE-89}
 * @param severity     严重程度：{@code HIGH / MEDIUM / LOW}
 * @param status       当前状态，初始为 {@code SUSPECTED}
 * @param unitId       对应 CodeUnit 的 id
 * @param qualifiedName 全限定名，供 UI 展示
 * @param filePath     相对文件路径
 * @param startLine    起始行号（1-based）
 * @param title        漏洞标题（由规则提供）
 * @param detail       匹配上下文或说明
 * @param foundAt      首次发现时间（ISO-8601）
 * @author leolu
 * @since 0.5.0
 */
public record VulnFinding(
        String id,
        String projectId,
        String ruleId,
        String cwe,
        String severity,
        String status,
        String unitId,
        String qualifiedName,
        String filePath,
        int startLine,
        String title,
        String detail,
        String foundAt
) {
    public static final String SUSPECTED  = "SUSPECTED";
    public static final String CONFIRMED  = "CONFIRMED";
    public static final String FIXED      = "FIXED";
    public static final String DISMISSED  = "DISMISSED";

    public static final java.util.Set<String> VALID_STATUSES =
            java.util.Set.of(SUSPECTED, CONFIRMED, FIXED, DISMISSED);
}
