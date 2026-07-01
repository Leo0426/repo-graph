package com.repograph.sbom;

import java.nio.file.Path;

/**
 * SBOM 生成服务接口，将项目依赖信息导出为标准格式。
 *
 * @author leolu
 * @since 0.1.0
 */
public interface SbomService {

    /**
     * 解析项目依赖并生成 CycloneDX JSON 格式的 SBOM。
     *
     * <p>支持 Maven（pom.xml）、Gradle（build.gradle[.kts]）、npm（package.json）、
     * pip（pyproject.toml / requirements*.txt）。
     *
     * @param projectRoot 项目根目录
     * @return CycloneDX JSON 字符串，不为 {@code null}
     * @throws SbomException 未找到受支持的构建文件或解析失败时抛出
     */
    String generateCycloneDx(Path projectRoot);
}
