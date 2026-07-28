package com.repograph.scanner;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.file.Path;

/**
 * 外部扫描器执行配置。
 *
 * @param workDir               受控输出根目录
 * @param defaultTimeoutSeconds 默认扫描超时
 * @param maxOutputMb           单个工具输出文件上限
 * @param maxFindings           单次最多导入报警数
 * @param semgrepCommand        Semgrep 可执行命令
 * @param semgrepConfig         Semgrep 规则配置
 * @param codeqlCommand         CodeQL 可执行命令
 * @param codeqlQuerySuite      CodeQL 查询套件
 * @author leolu
 */
@ConfigurationProperties(prefix = "repograph.scanners")
public record ScannerProperties(
        Path workDir,
        long defaultTimeoutSeconds,
        long maxOutputMb,
        int maxFindings,
        String semgrepCommand,
        String semgrepConfig,
        String codeqlCommand,
        String codeqlQuerySuite
) {
    /** 每 MB 的字节数。 */
    public static final long BYTES_PER_MB = 1024L * 1024L;

    /**
     * 返回单个输出文件最大字节数。
     *
     * @return 输出字节上限
     */
    public long maxOutputBytes() {
        return Math.multiplyExact(maxOutputMb, BYTES_PER_MB);
    }
}
