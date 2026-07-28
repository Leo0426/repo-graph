package com.repograph.asset;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.file.Path;

/**
 * 源码归档接入安全配置。
 *
 * @param rootDir              RepoGraph 托管资产根目录
 * @param maxUploadMb          最大归档上传大小，单位 MB
 * @param maxExtractedMb       最大累计解压大小，单位 MB
 * @param maxEntries           最大归档条目数
 * @param maxSingleFileMb      最大单文件解压大小，单位 MB
 * @param maxDepth             最大目录深度
 * @author leolu
 */
@ConfigurationProperties(prefix = "repograph.assets")
public record ArchiveProperties(
        Path rootDir,
        long maxUploadMb,
        long maxExtractedMb,
        int maxEntries,
        long maxSingleFileMb,
        int maxDepth
) {

    /** 每 MB 的字节数。 */
    public static final long BYTES_PER_MB = 1024L * 1024L;

    /**
     * 最大归档字节数。
     *
     * @return 字节数
     */
    public long maxUploadBytes() {
        return Math.multiplyExact(maxUploadMb, BYTES_PER_MB);
    }

    /**
     * 最大累计解压字节数。
     *
     * @return 字节数
     */
    public long maxExtractedBytes() {
        return Math.multiplyExact(maxExtractedMb, BYTES_PER_MB);
    }

    /**
     * 最大单文件字节数。
     *
     * @return 字节数
     */
    public long maxSingleFileBytes() {
        return Math.multiplyExact(maxSingleFileMb, BYTES_PER_MB);
    }
}
