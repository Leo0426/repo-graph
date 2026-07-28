package com.repograph.core.scanner;

/**
 * 单个外部扫描器运行状态。
 *
 * @author leolu
 */
public enum ScannerRunStatus {
    /** 扫描成功并完成结果导入。 */
    SUCCEEDED,
    /** 多语言扫描中至少一种语言成功且至少一种失败。 */
    PARTIAL,
    /** 扫描器执行或结果导入失败。 */
    FAILED,
    /** 扫描超过允许时限并被终止。 */
    TIMED_OUT,
    /** 所需命令不可执行或版本探测失败。 */
    UNAVAILABLE
}
