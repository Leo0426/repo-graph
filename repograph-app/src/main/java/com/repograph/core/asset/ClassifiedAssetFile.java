package com.repograph.core.asset;

/**
 * 资产中的单个文件及其分类依据。
 *
 * @param path      相对项目根目录的规范化路径
 * @param category  文件类别
 * @param reason    分类原因
 * @param language  识别出的语言或文件类型，未知时为空
 * @param sizeBytes 文件字节数
 * @author leolu
 */
public record ClassifiedAssetFile(
        String path,
        AssetFileCategory category,
        String reason,
        String language,
        long sizeBytes
) {}
