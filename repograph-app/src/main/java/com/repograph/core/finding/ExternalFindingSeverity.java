package com.repograph.core.finding;

import java.util.Locale;

/**
 * 外部 SAST / SCA 工具报警严重程度的归一化枚举。
 *
 * @author leolu
 */
public enum ExternalFindingSeverity {

    /** 阻断级风险，通常需要立即处理。 */
    CRITICAL,

    /** 高危风险。 */
    HIGH,

    /** 中危风险。 */
    MEDIUM,

    /** 低危风险。 */
    LOW,

    /** 信息类发现。 */
    INFO,

    /** 外部工具未提供或无法识别的严重程度。 */
    UNKNOWN;

    /**
     * 将外部工具的严重程度字符串归一化为枚举。
     *
     * @param raw 外部严重程度字符串，可为空
     * @return 归一化严重程度；无法识别时返回 {@link #UNKNOWN}
     */
    public static ExternalFindingSeverity from(String raw) {
        if (raw == null || raw.isBlank()) return UNKNOWN;
        String value = raw.trim().toUpperCase(Locale.ROOT).replace('-', '_');
        return switch (value) {
            case "ERROR", "CRITICAL", "BLOCKER" -> CRITICAL;
            case "HIGH", "MAJOR" -> HIGH;
            case "WARNING", "WARN", "MEDIUM", "MODERATE" -> MEDIUM;
            case "LOW", "MINOR" -> LOW;
            case "INFO", "INFORMATIONAL", "NOTE" -> INFO;
            default -> UNKNOWN;
        };
    }
}
