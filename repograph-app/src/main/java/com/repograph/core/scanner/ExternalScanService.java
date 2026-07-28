package com.repograph.core.scanner;

import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.finding.ExternalFinding;

import java.util.List;
import java.util.Optional;

/**
 * 外部扫描器编排和查询边界。
 *
 * @author leolu
 */
public interface ExternalScanService {

    /**
     * 探测所有已注册扫描器。
     *
     * @return 扫描器可用性列表
     */
    List<ScannerAvailability> capabilities();

    /**
     * 对一个已就绪托管资产执行所选扫描器。
     *
     * @param asset   托管资产
     * @param options 执行选项
     * @return 聚合批次结果
     */
    ExternalScanBatchResult scan(ImportedAsset asset, ExternalScanOptions options);

    /**
     * 查询单次扫描运行。
     *
     * @param scanId 扫描运行标识
     * @return 运行结果
     */
    Optional<ScannerRunResult> findRun(String scanId);

    /**
     * 查询项目扫描运行历史。
     *
     * @param projectId 项目标识
     * @return 按时间倒序的运行历史
     */
    List<ScannerRunResult> listRuns(String projectId);

    /**
     * 查询项目去重后的外部报警。
     *
     * @param projectId 项目标识
     * @return 按最后发现时间倒序的报警
     */
    List<ExternalFinding> listFindings(String projectId);

    /**
     * 删除项目的扫描历史和外部报警。
     *
     * @param projectId 项目标识
     */
    void removeProject(String projectId);
}
