package com.repograph.core.finding;

import java.util.List;
import java.util.Optional;

/**
 * 审核队列服务契约：提交研判报告快照生成待审条目，并支持认领、退回、确认、驳回四种
 * 记录操作者/时间/理由的状态迁移。
 *
 * @author leolu
 */
public interface ReviewQueueService {

    /**
     * 持久化一份报告快照，并为其中每条研判报告生成一条 {@code PENDING} 队列条目。
     *
     * @param snapshot 待持久化的报告快照
     * @return 新生成的队列条目，顺序与快照内报告一致
     */
    List<ReviewQueueEntry> submit(ReportSnapshot snapshot);

    /**
     * 按条件筛选审核队列条目。
     *
     * @param projectId      项目标识，必填
     * @param severity       可选严重程度过滤
     * @param verdict        可选结论过滤
     * @param status         可选状态过滤
     * @param ruleId         可选规则标识过滤
     * @param updatedAfter   可选更新时间下界（ISO-8601，含）
     * @param updatedBefore  可选更新时间上界（ISO-8601，不含）
     * @return 按更新时间降序的条目列表
     */
    List<ReviewQueueEntry> list(
            String projectId,
            ExternalFindingSeverity severity,
            TriageVerdict verdict,
            ReviewStatus status,
            String ruleId,
            String updatedAfter,
            String updatedBefore);

    /**
     * 认领一条待审条目（{@code PENDING -> IN_REVIEW}）。仅允许从 {@code PENDING} 发起，
     * 避免在他人复核中途被静默改派。
     *
     * @param entryId    条目标识
     * @param actor      认领人
     * @param occurredAt 操作时间
     * @return 条目是否存在且处于 {@code PENDING}
     */
    boolean claim(String entryId, String actor, String occurredAt);

    /**
     * 退回一条正在复核的条目（{@code IN_REVIEW -> PENDING}），清空认领人。
     *
     * @param entryId    条目标识
     * @param actor      操作人
     * @param reason     退回理由
     * @param occurredAt 操作时间
     * @return 条目是否存在且处于 {@code IN_REVIEW}
     */
    boolean returnToQueue(String entryId, String actor, String reason, String occurredAt);

    /**
     * 确认一条正在复核的条目为真实风险（{@code IN_REVIEW -> CONFIRMED}）。
     *
     * @param entryId    条目标识
     * @param actor      操作人
     * @param reason     确认理由
     * @param occurredAt 操作时间
     * @return 条目是否存在且处于 {@code IN_REVIEW}
     */
    boolean confirm(String entryId, String actor, String reason, String occurredAt);

    /**
     * 驳回一条正在复核的条目（{@code IN_REVIEW -> REJECTED}）。
     *
     * @param entryId    条目标识
     * @param actor      操作人
     * @param reason     驳回理由
     * @param occurredAt 操作时间
     * @return 条目是否存在且处于 {@code IN_REVIEW}
     */
    boolean reject(String entryId, String actor, String reason, String occurredAt);

    /**
     * 查询条目的不可变审计事件。
     *
     * @param entryId 条目标识
     * @return 按时间升序的事件
     */
    List<ReviewQueueAuditEvent> audit(String entryId);

    /**
     * 按标识查询报告快照。
     *
     * @param snapshotId 快照标识
     * @return 快照；不存在时为空
     */
    Optional<ReportSnapshot> getSnapshot(String snapshotId);
}
