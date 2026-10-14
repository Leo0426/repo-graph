package com.repograph.core.securityreview;

import java.time.Instant;
import java.util.List;

/**
 * 配置核查报告。
 *
 * @param dimensionsAudited 实际参与核查的维度（有规则且被请求）
 * @param checkedRules      评估的规则数
 * @param scannedFiles      核查的文件数
 * @param violations        违规项列表
 * @param generatedAt       报告生成时间
 * @author leolu
 */
public record ConfigAuditReport(
        List<AuditDimension> dimensionsAudited,
        int checkedRules,
        int scannedFiles,
        List<ConfigViolation> violations,
        Instant generatedAt) {

    /**
     * 紧凑构造器：null 集合归一为空列表。
     */
    public ConfigAuditReport {
        dimensionsAudited = dimensionsAudited == null ? List.of() : List.copyOf(dimensionsAudited);
        violations = violations == null ? List.of() : List.copyOf(violations);
    }
}
