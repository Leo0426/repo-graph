package com.repograph.core.scanner;

import com.repograph.core.finding.ExternalFinding;

import java.util.List;

/**
 * 扫描任务归一化报警的一页。
 *
 * @param findings 当前页报警
 * @param page     页码，从 0 起
 * @param size     每页大小
 * @param total    去重后报警总数
 * @author leolu
 */
public record ScanTaskFindingsPage(
        List<ExternalFinding> findings,
        int page,
        int size,
        long total
) {
    /**
     * 创建不可变分页结果。
     */
    public ScanTaskFindingsPage {
        findings = findings == null ? List.of() : List.copyOf(findings);
    }
}
