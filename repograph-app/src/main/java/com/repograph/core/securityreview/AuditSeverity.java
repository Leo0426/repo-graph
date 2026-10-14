package com.repograph.core.securityreview;

/**
 * 核查发现与威胁记录的严重程度。
 *
 * @author leolu
 */
public enum AuditSeverity {

    /** 高：直接构成安全缺陷或违规行为，需立即处置。 */
    HIGH,

    /** 中：削弱防护能力，存在被利用风险。 */
    MEDIUM,

    /** 低：规范性缺陷，建议整改。 */
    LOW
}
