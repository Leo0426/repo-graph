package com.repograph.app.cli;

import com.repograph.sbom.SbomException;
import com.repograph.sbom.SbomService;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.nio.file.Path;

/**
 * {@code repograph sbom} 子命令，从项目 pom.xml 生成 CycloneDX JSON 格式的 SBOM。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
    name = "sbom",
    mixinStandardHelpOptions = true,
    description = "生成 SBOM（软件物料清单，CycloneDX JSON 格式）。" +
                  "支持 Maven（pom.xml）、Gradle（build.gradle[.kts]）、npm（package.json）、pip（pyproject.toml / requirements.txt）。"
)
@Component
public class SbomCommand implements Runnable {

    @Parameters(index = "0", description = "项目根目录路径")
    private Path projectRoot;

    @Option(names = "--format", description = "输出格式：cyclonedx（默认）", defaultValue = "cyclonedx")
    private String format;

    private final SbomService sbomService;

    /**
     * 通过构造器注入 SBOM 生成服务。
     *
     * @param sbomService SBOM 生成服务，不为 {@code null}
     */
    public SbomCommand(SbomService sbomService) {
        this.sbomService = sbomService;
    }

    @Override
    public void run() {
        try {
            String sbom = sbomService.generateCycloneDx(projectRoot);
            System.out.println(sbom);
        } catch (SbomException e) {
            System.err.println("[ERROR] SBOM generation failed: " + e.getMessage());
        }
    }
}
