package com.repograph.core.asset;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * 项目资产画像快照。
 *
 * @param assetId             资产标识
 * @param projectId           项目标识
 * @param projectRoot         RepoGraph 托管的项目根目录
 * @param generatedAt         生成时间，ISO-8601
 * @param totalFiles          文件总数
 * @param categoryDistribution 文件类别分布
 * @param languageDistribution 语言或文件类型分布
 * @param files               文件分类明细
 * @param frameworks          识别出的框架
 * @param buildSystems        识别出的构建系统
 * @param dependencies        依赖资产
 * @param riskSignals         聚合风险信号
 * @param scannerPlan         扫描器推荐计划
 * @param omittedReasons      无法获取的可选分析及原因
 * @author leolu
 */
public record ProjectAssetProfile(
        String assetId,
        String projectId,
        Path projectRoot,
        String generatedAt,
        long totalFiles,
        Map<String, Long> categoryDistribution,
        Map<String, Long> languageDistribution,
        List<ClassifiedAssetFile> files,
        List<String> frameworks,
        List<String> buildSystems,
        List<DependencyAsset> dependencies,
        List<AssetRiskSignal> riskSignals,
        List<ScannerPlanItem> scannerPlan,
        List<String> omittedReasons
) {
    /**
     * 创建不可变画像快照。
     */
    public ProjectAssetProfile {
        categoryDistribution = Map.copyOf(categoryDistribution);
        languageDistribution = Map.copyOf(languageDistribution);
        files = List.copyOf(files);
        frameworks = List.copyOf(frameworks);
        buildSystems = List.copyOf(buildSystems);
        dependencies = List.copyOf(dependencies);
        riskSignals = List.copyOf(riskSignals);
        scannerPlan = List.copyOf(scannerPlan);
        omittedReasons = List.copyOf(omittedReasons);
    }
}
