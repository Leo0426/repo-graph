package com.repograph.metrics;

/**
 * 代码热点度量结果，聚合单个源文件的 Git 变更频率与圈复杂度。
 *
 * <p>热点分（hotspotScore）= {@code ln(churnCount + 1) × avgComplexity}
 * 使用对数压缩频繁变更文件的影响，避免单一高频文件主导排名。
 * 热点分越高，说明该文件既复杂又频繁变更，应优先重构。
 *
 * @param filePath       相对于项目根目录的源文件路径
 * @param churnCount     统计周期内（最近 1000 次提交）该文件被修改的提交次数
 * @param methodCount    文件内拥有复杂度数据的方法数
 * @param avgComplexity  文件内所有方法圈复杂度的平均值（保留 2 位小数）
 * @param hotspotScore   综合热点分 = ln(churnCount+1) × avgComplexity（保留 2 位小数）
 * @author leolu
 * @since 0.7.0
 */
public record HotspotMetric(
        String filePath,
        int churnCount,
        int methodCount,
        double avgComplexity,
        double hotspotScore
) {}
