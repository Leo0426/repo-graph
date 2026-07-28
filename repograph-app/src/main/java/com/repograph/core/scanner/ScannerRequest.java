package com.repograph.core.scanner;

import java.nio.file.Path;
import java.util.List;

/**
 * 单个外部扫描器执行请求。
 *
 * @param scanId         扫描运行唯一标识
 * @param projectId      项目标识
 * @param projectRoot    已确认的 RepoGraph 托管项目根目录
 * @param languages      资产画像识别出的语言
 * @param timeoutSeconds 最大执行秒数
 * @author leolu
 */
public record ScannerRequest(
        String scanId,
        String projectId,
        Path projectRoot,
        List<String> languages,
        long timeoutSeconds
) {
    /**
     * 创建不可变扫描请求。
     */
    public ScannerRequest {
        languages = languages == null ? List.of() : List.copyOf(languages);
    }
}
