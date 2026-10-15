package com.repograph.core.wiki;

import java.util.List;

/**
 * 一份分层摘要文档（项目级或包级）。
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
 * @param sections    有序章节列表（source 区分 facts / llm）
 * @param citations   全文引用过的符号列表（LLM 章节已过白名单校验并去重）
 * @param docVersion  版本号，同一 (projectId, scopeId) 内从 1 递增
 * @param generatedAt ISO-8601 生成时间
 * @param status      {@code COMPLETED} 或 {@code PARTIAL}（任一 LLM 章节失败时显式降级）
 * @param model       生成 LLM 章节使用的模型名称；无 LLM 章节时为 {@code null}
 * @param missingInfo LLM 引用了白名单外符号等缺失/丢弃信息说明；不为 {@code null}
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
        String status,
        String model,
        List<String> missingInfo
) {

    /** PROJECT 级摘要的固定 scopeId。 */
    public static final String PROJECT_SCOPE = "__project__";

    /** 生成完整成功。 */
    public static final String STATUS_COMPLETED = "COMPLETED";

    /** 事实收集或 LLM 章节部分失败，文档显式标注降级。 */
    public static final String STATUS_PARTIAL = "PARTIAL";

    public SummaryDocument {
        if (sections == null) sections = List.of();
        if (citations == null) citations = List.of();
        if (missingInfo == null) missingInfo = List.of();
        sections = List.copyOf(sections);
        citations = List.copyOf(citations);
        missingInfo = List.copyOf(missingInfo);
    }

    /**
     * 兼容构造：无 LLM 章节（S1 确定性文档）。
     */
    public SummaryDocument(String id, String projectId, SummaryLevel level, String scopeId,
                           String title, List<SummarySection> sections,
                           List<SummaryCitation> citations, int docVersion,
                           String generatedAt, String status) {
        this(id, projectId, level, scopeId, title, sections, citations,
                docVersion, generatedAt, status, null, List.of());
    }
}
