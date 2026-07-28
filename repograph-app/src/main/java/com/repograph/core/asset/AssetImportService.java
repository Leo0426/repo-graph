package com.repograph.core.asset;

import com.repograph.core.pipeline.IndexOptions;

import java.io.InputStream;
import java.util.Optional;

/**
 * 不可信源码归档接入、查询与清理的应用边界。
 *
 * @author leolu
 */
public interface AssetImportService {

    /**
     * 保存并安全提取上传归档，然后异步启动索引。
     *
     * @param input            上传内容
     * @param originalFileName 原始文件名，仅用于展示
     * @param contentLength    HTTP 声明的内容长度，未知时为负数
     * @param options          索引选项
     * @return 状态为 {@link AssetStatus#INDEXING} 的资产快照
     */
    ImportedAsset importArchive(InputStream input, String originalFileName,
                                long contentLength, IndexOptions options);

    /**
     * 查询资产及其最近索引结果。
     *
     * @param assetId 资产 ID
     * @return 资产快照
     */
    Optional<ImportedAsset> find(String assetId);

    /**
     * 删除资产的索引数据、漏洞数据、历史记录和受控源码目录。
     *
     * @param assetId 资产 ID
     * @return 是否找到并删除了资产
     */
    boolean delete(String assetId);

    /**
     * 在项目索引数据被删除前检查托管资产是否允许删除。
     *
     * @param projectId 项目 ID
     * @throws AssetBusyException 若资产仍在索引
     */
    void validateProjectDeletion(String projectId);

    /**
     * 若项目属于归档接入资产，则按项目 ID 清理受控目录和资产记录。
     *
     * @param projectId 项目 ID
     */
    void cleanupManagedProject(String projectId);
}
