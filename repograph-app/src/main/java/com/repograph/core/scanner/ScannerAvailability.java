package com.repograph.core.scanner;

/**
 * 外部扫描器当前可用性。
 *
 * @param capability  静态能力声明
 * @param available   命令是否可执行且版本探测成功
 * @param toolVersion 工具版本
 * @param error       不可用原因
 * @author leolu
 */
public record ScannerAvailability(
        ScannerCapability capability,
        boolean available,
        String toolVersion,
        String error
) {
    /**
     * 规范化可用性结果。
     */
    public ScannerAvailability {
        toolVersion = toolVersion == null ? "" : toolVersion;
        error = error == null ? "" : error;
    }
}
