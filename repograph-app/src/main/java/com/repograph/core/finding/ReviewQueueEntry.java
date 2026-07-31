package com.repograph.core.finding;

/**
 * 审核队列中的一条可筛选行，对应某个 {@link ReportSnapshot} 里的一条 {@link TriageReport}。
 *
 * @param id          条目标识
 * @param snapshotId  所属报告快照标识
 * @param projectId   项目标识
 * @param fingerprint 报警指纹（{@link ExternalFinding#fingerprint()}）
 * @param ruleId      外部规则标识
 * @param cwe         CWE 编号；未知为空字符串
 * @param severity    归一化严重程度
 * @param verdict     生成时的启发式/研判结论
 * @param confidence  结论置信度 [0, 1]
 * @param status      当前审核状态
 * @param claimedBy   认领人；未认领时为空字符串
 * @param claimedAt   认领时间；未认领时为空字符串
 * @param updatedAt   最近一次状态变更时间
 * @author leolu
 */
public record ReviewQueueEntry(
        String id,
        String snapshotId,
        String projectId,
        String fingerprint,
        String ruleId,
        String cwe,
        ExternalFindingSeverity severity,
        TriageVerdict verdict,
        float confidence,
        ReviewStatus status,
        String claimedBy,
        String claimedAt,
        String updatedAt
) {
    /**
     * 创建审核队列条目并归一化可空字符串。
     */
    public ReviewQueueEntry {
        claimedBy = claimedBy == null ? "" : claimedBy;
        claimedAt = claimedAt == null ? "" : claimedAt;
    }
}
