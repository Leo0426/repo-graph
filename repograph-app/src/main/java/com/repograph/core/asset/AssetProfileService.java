package com.repograph.core.asset;

/**
 * 资产画像生成边界。
 *
 * @author leolu
 */
public interface AssetProfileService {

    /**
     * 为已完成索引的资产生成当前画像。
     *
     * @param asset   资产快照
     * @param options 扫描器覆盖选项
     * @return 项目资产画像
     */
    ProjectAssetProfile build(ImportedAsset asset, AssetProfileOptions options);
}
