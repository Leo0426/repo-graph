package com.repograph.core.wiki;

import java.util.List;

/**
 * 一份分层摘要文档（项目级或包级），确定性事实的 Markdown 组织形式。
 *
 * <p>摘要是派生事实：不得创建、升级或降级 VulnFinding/TriageReport；
 * 研判流水线不消费摘要结论。每次生成分配递增的 {@code docVersion}，
 * 旧版本保留可回看（见 SummaryStore）。
 *
 * @param id          唯一标识符（UUID），由存储层分配
 * @param projectId   所属项目标识
 * @param level       摘要级别
 * @param scopeId     PROJECT 级为 {@code "__project__"}；PACKAGE 级为完整包名
 * @param title       文档标题
 * @param sections    有序章节列表
 * @param citations   全文引用过的符号列表（已去重）
 * @param docVersion  版本号，同一 (projectId, scopeId) 内从 1 递增
 * @param generatedAt ISO-8601 生成时间
 * @param status      {@code COMPLETED} 或 {@code PARTIAL}（事实收集部分失败时显式降级）
 * @author leolu
 * @since 0.7.0
 */
public record SummaryDocument(
        String id,
        String projectId,
        SummaryLevel level,
        String scopeId,
        String title,
        List<SummarySection> sections,
        List<SummaryCitation> citations,
        int docVersion,
        String generatedAt,
        String status
) {

    /** PROJECT 级摘要的固定 scopeId。 */
    public static final String PROJECT_SCOPE = "__project__";

    /** 生成完整成功。 */
    public static final String STATUS_COMPLETED = "COMPLETED";

    /** 事实收集部分失败，文档显式标注降级。 */
    public static final String STATUS_PARTIAL = "PARTIAL";

    public SummaryDocument {
        if (sections == null) sections = List.of();
        if (citations == null) citations = List.of();
        sections = List.copyOf(sections);
        citations = List.copyOf(citations);
    }
}
