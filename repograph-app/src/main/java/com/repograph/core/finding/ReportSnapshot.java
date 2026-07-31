package com.repograph.core.finding;

import java.util.List;

/**
 * 生成后即冻结的研判报告快照：把某次批量研判的结果、版本信息和生成时间固化下来，
 * 作为审核队列条目和 Markdown/JSON/PDF 导出的唯一事实来源。
 *
 * @param id            快照标识
 * @param projectId     项目标识
 * @param schemaVersion 快照结构版本，当前固定 {@code "1"}
 * @param toolVersion   生成快照时的 RepoGraph 应用版本
 * @param codeVersion   生成时的代码版本，如 commit SHA；未提供为空字符串
 * @param ruleVersion   生成时的扫描规则版本；未提供为空字符串
 * @param generatedAt   生成时间，ISO-8601
 * @param reports       本次批量研判的全部报告，顺序与提交时一致
 * @author leolu
 */
public record ReportSnapshot(
        String id,
        String projectId,
        String schemaVersion,
        String toolVersion,
        String codeVersion,
        String ruleVersion,
        String generatedAt,
        List<TriageReport> reports
) {
    /**
     * 创建报告快照并做不可变防御拷贝。
     */
    public ReportSnapshot {
        codeVersion = codeVersion == null ? "" : codeVersion;
        ruleVersion = ruleVersion == null ? "" : ruleVersion;
        reports = List.copyOf(reports);
    }
}
