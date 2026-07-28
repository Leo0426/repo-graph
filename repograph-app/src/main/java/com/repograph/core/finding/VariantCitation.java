package com.repograph.core.finding;

/**
 * 漏洞变体候选的源码引用。
 *
 * @param qualifiedName 代码单元全限定名
 * @param filePath      项目相对路径
 * @param startLine     起始行
 * @param endLine       结束行
 * @author leolu
 */
public record VariantCitation(
        String qualifiedName,
        String filePath,
        int startLine,
        int endLine
) {}
