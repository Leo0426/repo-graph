package com.repograph.core.scanner;

import java.util.List;

/**
 * 一次异步扫描任务的元数据。任务包裹一批扫描器执行，结果批次快照单独持久化，
 * 通过 {@link ScanTaskService#result(String)} 获取。
 *
 * @param id             任务标识
 * @param projectId      项目标识
 * @param assetId        资产标识（重跑时据此重新定位托管资产）
 * @param scanners       要运行的扫描器标识
 * @param languages      资产画像识别出的语言
 * @param timeoutSeconds 每个扫描器的最大执行秒数
 * @param status         任务状态
 * @param attempt        执行次数，从 1 起（重试递增）
 * @param batchId        运行产生的批次标识；未运行时为空串
 * @param error          任务级结构化失败摘要；无错误时为空串
 * @param createdAt      创建时间，ISO-8601
 * @param updatedAt      最后更新时间，ISO-8601
 * @author leolu
 */
public record ScanTask(
        String id,
        String projectId,
        String assetId,
        List<String> scanners,
        List<String> languages,
        long timeoutSeconds,
        ScanTaskStatus status,
        int attempt,
        String batchId,
        String error,
        String createdAt,
        String updatedAt
) {
    /**
     * 创建不可变任务，规范化可空字段。
     */
    public ScanTask {
        scanners = scanners == null ? List.of() : List.copyOf(scanners);
        languages = languages == null ? List.of() : List.copyOf(languages);
        batchId = batchId == null ? "" : batchId;
        error = error == null ? "" : error;
    }
}
