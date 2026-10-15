package com.repograph.core.wiki;

/**
 * 摘要文档中的一个章节。
 *
 * @param title 章节标题，不为 {@code null}
 * @param body  章节正文（Markdown 片段，不含标题行），不为 {@code null}
 * @author leolu
 * @since 0.7.0
 */
public record SummarySection(String title, String body) {

    public SummarySection {
        if (title == null) title = "";
        if (body == null) body = "";
    }
}
