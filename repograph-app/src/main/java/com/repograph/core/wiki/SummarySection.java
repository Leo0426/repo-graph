package com.repograph.core.wiki;

/**
 * 摘要文档中的一个章节。
 *
 * @param title  章节标题，不为 {@code null}
 * @param body   章节正文（Markdown 片段，不含标题行），不为 {@code null}
 * @param source 章节来源：{@code "facts"}（图查询事实确定性生成）或
 *               {@code "llm"}（模型生成，citation 已过白名单校验）；
 *               旧版本数据缺省视为 {@code "facts"}
 * @author leolu
 * @since 0.7.0
 */
public record SummarySection(String title, String body, String source) {

    /** 章节来源：确定性事实。 */
    public static final String SOURCE_FACTS = "facts";

    /** 章节来源：模型生成。 */
    public static final String SOURCE_LLM = "llm";

    public SummarySection {
        if (title == null) title = "";
        if (body == null) body = "";
        if (source == null || source.isBlank()) source = SOURCE_FACTS;
    }

    /**
     * 兼容构造：S1 确定性章节。
     *
     * @param title 章节标题
     * @param body  章节正文
     */
    public SummarySection(String title, String body) {
        this(title, body, SOURCE_FACTS);
    }
}
