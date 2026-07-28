package com.repograph.core.asset;

import java.nio.file.Path;

/**
 * 安全归档提取结果。
 *
 * @param archiveType   实际检测出的归档格式
 * @param projectRoot   应交给索引管道的项目根目录
 * @param fileCount     提取出的普通文件数量
 * @param extractedBytes 实际提取字节数
 * @author leolu
 */
public record ArchiveExtractResult(
        String archiveType,
        Path projectRoot,
        int fileCount,
        long extractedBytes
) {}
