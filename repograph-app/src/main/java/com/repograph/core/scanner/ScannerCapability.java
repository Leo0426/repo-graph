package com.repograph.core.scanner;

import java.util.List;

/**
 * 外部扫描器能力声明。
 *
 * @param scanner       扫描器标识
 * @param languages     支持的语言
 * @param requiredCommand 所需命令
 * @param outputFormat  输出格式
 * @param prerequisites 运行前置条件
 * @author leolu
 */
public record ScannerCapability(
        String scanner,
        List<String> languages,
        String requiredCommand,
        String outputFormat,
        List<String> prerequisites
) {
    /**
     * 创建不可变能力声明。
     */
    public ScannerCapability {
        languages = List.copyOf(languages);
        prerequisites = List.copyOf(prerequisites);
    }
}
