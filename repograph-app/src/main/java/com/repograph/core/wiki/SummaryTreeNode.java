package com.repograph.core.wiki;

import java.util.List;

/**
 * 文档树节点（DeepMap FileNode 的简化版），供 Web 文档树浏览。
 *
 * @param name       节点显示名（PROJECT 级为文档标题，PACKAGE 级为包名）
 * @param path       树路径，形如 {@code project} 或 {@code package/com.example.foo}
 * @param level      摘要级别小写（{@code project} / {@code package}）
 * @param docVersion 当前最新版本号
 * @param keywords   关键符号 qualifiedName（取引用列表前 5 个）
 * @author leolu
 * @since 0.7.0
 */
public record SummaryTreeNode(String name, String path, String level, int docVersion,
                              List<String> keywords) {

    public SummaryTreeNode {
        if (keywords == null) keywords = List.of();
        keywords = List.copyOf(keywords);
    }

    /**
     * 从摘要文档构建树节点。
     *
     * @param document 摘要文档（取最新版本）
     * @return 树节点
     */
    public static SummaryTreeNode from(SummaryDocument document) {
        String level = document.level() == SummaryLevel.PROJECT ? "project" : "package";
        String path = document.level() == SummaryLevel.PROJECT
                ? "project"
                : "package/" + document.scopeId();
        String name = document.level() == SummaryLevel.PROJECT
                ? document.title()
                : document.scopeId();
        List<String> keywords = document.citations().stream()
                .map(SummaryCitation::qualifiedName)
                .limit(5)
                .toList();
        return new SummaryTreeNode(name, path, level, document.docVersion(), keywords);
    }
}
