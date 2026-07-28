package com.repograph.core.asset;

/**
 * 不可信源码归档的安全提取边界。
 *
 * @author leolu
 */
public interface ArchiveExtractor {

    /**
     * 校验并提取归档，返回实际项目根目录。
     *
     * @param request 提取请求
     * @return 提取结果
     */
    ArchiveExtractResult extract(ArchiveExtractRequest request);
}
