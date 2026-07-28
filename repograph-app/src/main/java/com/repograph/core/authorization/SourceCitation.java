package com.repograph.core.authorization;

/**
 * 可定位到源码的证据引用。
 *
 * @param qualifiedName 代码单元全限定名
 * @param filePath      项目内相对文件路径
 * @param startLine     起始行号
 * @param endLine       结束行号
 * @author leolu
 */
public record SourceCitation(
        String qualifiedName,
        String filePath,
        int startLine,
        int endLine
) {}
