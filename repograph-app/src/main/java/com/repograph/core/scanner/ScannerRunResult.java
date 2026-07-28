package com.repograph.core.scanner;

import com.repograph.core.finding.ExternalFinding;

import java.util.List;

/**
 * 单个外部扫描器运行结果。
 *
 * @param scanId      扫描运行标识
 * @param projectId   项目标识
 * @param scanner     扫描器标识
 * @param status      运行状态
 * @param toolVersion 工具版本
 * @param exitCode    进程退出码；未启动或超时时为 -1
 * @param durationMs  运行耗时
 * @param startedAt   开始时间，ISO-8601
 * @param finishedAt  结束时间，ISO-8601
 * @param findings    已归一化报警
 * @param error       结构化失败摘要
 * @author leolu
 */
public record ScannerRunResult(
        String scanId,
        String projectId,
        String scanner,
        ScannerRunStatus status,
        String toolVersion,
        int exitCode,
        long durationMs,
        String startedAt,
        String finishedAt,
        List<ExternalFinding> findings,
        String error
) {
    /**
     * 创建不可变扫描结果。
     */
    public ScannerRunResult {
        findings = findings == null ? List.of() : List.copyOf(findings);
        toolVersion = toolVersion == null ? "" : toolVersion;
        error = error == null ? "" : error;
    }
}
