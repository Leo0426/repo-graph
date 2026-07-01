package com.repograph.vuln;

import java.util.List;
import java.util.Map;

/**
 * 项目漏洞报告快照，包含统计摘要和所有已确认发现的完整列表。
 *
 * @param projectId        项目 ID
 * @param generatedAt      报告生成时间（ISO-8601）
 * @param totalFindings    所有状态的发现总数
 * @param bySeverity       按严重程度分布（HIGH/MEDIUM/LOW → 数量）
 * @param byStatus         按状态分布（SUSPECTED/CONFIRMED/FIXED/DISMISSED → 数量）
 * @param byCwe            按 CWE 分布
 * @param confirmedFindings 状态为 CONFIRMED 的发现完整列表，按 severity desc 排序
 * @author leolu
 * @since 0.5.0
 */
public record VulnReport(
        String projectId,
        String generatedAt,
        int totalFindings,
        Map<String, Long> bySeverity,
        Map<String, Long> byStatus,
        Map<String, Long> byCwe,
        List<VulnFinding> confirmedFindings
) {}
