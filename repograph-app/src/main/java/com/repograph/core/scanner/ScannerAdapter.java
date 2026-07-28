package com.repograph.core.scanner;

/**
 * 外部扫描器适配边界。
 *
 * @author leolu
 */
public interface ScannerAdapter {

    /**
     * 返回不依赖工具安装状态的静态能力声明。
     *
     * @return 扫描器能力
     */
    ScannerCapability capability();

    /**
     * 探测所需命令并返回当前工具版本。
     *
     * @return 扫描器当前可用性
     */
    ScannerAvailability probe();

    /**
     * 执行一次受控扫描并归一化输出。
     *
     * @param request 扫描请求
     * @return 扫描结果；工具不可用和执行失败以状态表达
     */
    ScannerRunResult scan(ScannerRequest request);
}
