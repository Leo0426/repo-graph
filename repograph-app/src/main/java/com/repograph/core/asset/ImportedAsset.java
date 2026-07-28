package com.repograph.core.asset;

import com.repograph.core.pipeline.IndexResult;

import java.nio.file.Path;

/**
 * RepoGraph 托管的源码归档资产快照。
 *
 * @param assetId         上传资产唯一标识
 * @param projectId       基于实际项目根目录生成的项目标识
 * @param originalFileName 客户端提供的原始文件名，仅作为展示元数据
 * @param archiveType     实际检测的归档格式
 * @param projectRoot     受控项目根目录
 * @param status          当前索引状态
 * @param error           失败摘要，非失败状态为空
 * @param createdAt       创建时间，ISO-8601
 * @param updatedAt       最近更新时间，ISO-8601
 * @param indexResult     索引完成后的统计，未完成或失败时为空
 * @author leolu
 */
public record ImportedAsset(
        String assetId,
        String projectId,
        String originalFileName,
        String archiveType,
        Path projectRoot,
        AssetStatus status,
        String error,
        String createdAt,
        String updatedAt,
        IndexResult indexResult
) {}
