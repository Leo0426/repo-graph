package com.repograph.core.asset;

import java.nio.file.Path;

/**
 * 安全归档提取请求。
 *
 * @param archivePath   已落盘的归档文件
 * @param destination   受控解压目录
 * @param contentLength 上传时声明的归档大小；未知时为负数
 * @author leolu
 */
public record ArchiveExtractRequest(Path archivePath, Path destination, long contentLength) {}
