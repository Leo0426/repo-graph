package com.repograph.core.asset;

/**
 * 从项目 SBOM 提取的依赖资产。
 *
 * @param coordinate 依赖坐标
 * @param version    版本
 * @param scope      依赖范围
 * @param purl       Package URL
 * @author leolu
 */
public record DependencyAsset(
        String coordinate,
        String version,
        String scope,
        String purl
) {}
