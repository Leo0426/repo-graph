package com.repograph.core.scanner;

import java.util.List;

/**
 * 一批外部扫描器的同步执行结果。
 *
 * @param batchId  批次标识
 * @param projectId 项目标识
 * @param status   聚合状态
 * @param runs     各扫描器独立结果
 * @author leolu
 */
public record ExternalScanBatchResult(
        String batchId,
        String projectId,
        ScanBatchStatus status,
        List<ScannerRunResult> runs
) {
    /**
     * 创建不可变批次结果。
     */
    public ExternalScanBatchResult {
        runs = List.copyOf(runs);
    }
}
