package com.repograph.core.wiki;

/**
 * 摘要中的来源引用，指向图内真实符号。
 *
 * <p>与 Context Pack 的 citation 规则对齐：只允许引用输入事实中存在的符号，
 * 私有仓库不使用外部 blob 链接。
 *
 * @param qualifiedName 符号全限定名，不为 {@code null}
 * @param filePath      相对项目根的文件路径，统一 {@code /} 分隔
 * @param startLine     起始行号，1-based
 * @param endLine       结束行号，1-based
 * @author leolu
 * @since 0.7.0
 */
public record SummaryCitation(String qualifiedName, String filePath, int startLine, int endLine) {

    public SummaryCitation {
        if (qualifiedName == null) qualifiedName = "";
        if (filePath == null) filePath = "";
    }
}
