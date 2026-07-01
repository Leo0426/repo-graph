package com.repograph.sbom;

import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 自动检测构建系统并委派给对应的 SBOM 生成服务。
 * 优先级：pom.xml（Maven）> build.gradle（Gradle）> package.json（npm）> pyproject.toml / requirements.txt（pip）。
 */
@Service
@Primary
public class DispatchSbomService implements SbomService {

    private final MavenSbomService maven;
    private final GradleSbomService gradle;
    private final NpmSbomService npm;
    private final PipSbomService pip;

    public DispatchSbomService(MavenSbomService maven, GradleSbomService gradle,
                                NpmSbomService npm, PipSbomService pip) {
        this.maven = maven;
        this.gradle = gradle;
        this.npm = npm;
        this.pip = pip;
    }

    @Override
    public String generateCycloneDx(Path projectRoot) {
        if (Files.exists(projectRoot.resolve("pom.xml"))) {
            return maven.generateCycloneDx(projectRoot);
        }
        if (Files.exists(projectRoot.resolve("build.gradle.kts"))
                || Files.exists(projectRoot.resolve("build.gradle"))
                || gradle.findVersionCatalog(projectRoot) != null) {
            return gradle.generateCycloneDx(projectRoot);
        }
        if (Files.exists(projectRoot.resolve("package.json"))) {
            return npm.generateCycloneDx(projectRoot);
        }
        if (Files.exists(projectRoot.resolve("pyproject.toml"))
                || hasRequirementsTxt(projectRoot)) {
            return pip.generateCycloneDx(projectRoot);
        }
        throw new SbomException(
            "No supported build file found in " + projectRoot
            + ". Expected pom.xml (Maven), build.gradle[.kts] (Gradle),"
            + " package.json (npm), pyproject.toml or requirements.txt (pip).");
    }

    private boolean hasRequirementsTxt(Path projectRoot) {
        try {
            return Files.list(projectRoot).anyMatch(p -> {
                String name = p.getFileName().toString();
                return name.startsWith("requirements") && name.endsWith(".txt");
            });
        } catch (Exception e) {
            return false;
        }
    }
}
