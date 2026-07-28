package com.repograph.core.scanner;

/**
 * 一批外部扫描器的聚合状态。
 *
 * @author leolu
 */
public enum ScanBatchStatus {
    /** 所有扫描器均成功。 */
    SUCCEEDED,
    /** 至少一个扫描器成功且至少一个未成功。 */
    PARTIAL,
    /** 没有扫描器成功。 */
    FAILED
}
