package com.repograph.app.cli;

import com.repograph.vuln.DepsVulnScanner;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Parameters;

import java.nio.file.Path;

/**
 * {@code repograph vuln scan-deps <projectId> <projectRoot>} — 解析 pom.xml 生成 SBOM
 * 并与内置 Advisory 数据库比对，找出已知 CVE。
 *
 * @author leolu
 * @since 0.5.0
 */
@Command(
    name = "scan-deps",
    mixinStandardHelpOptions = true,
    description = "扫描项目 Maven 依赖，匹配内置 CVE Advisory 数据库"
)
@Component
public class VulnScanDepsCommand implements Runnable {

    @Parameters(index = "0", description = "项目 ID（12 字符前缀）")
    private String projectId;

    @Parameters(index = "1", description = "项目根目录路径（需包含 pom.xml）")
    private Path projectRoot;

    private final DepsVulnScanner scanner;

    public VulnScanDepsCommand(DepsVulnScanner scanner) {
        this.scanner = scanner;
    }

    @Override
    public void run() {
        System.err.printf("Scanning dependencies for project: %s (%s)%n", projectId, projectRoot);
        DepsVulnScanner.ScanSummary summary = scanner.scan(projectId, projectRoot);
        System.err.printf("Done. Checked %d components, %d finding(s) written.%n",
                summary.scannedComponents(), summary.newFindings());
        System.out.printf("{\"projectId\":\"%s\",\"scannedComponents\":%d,\"newFindings\":%d}%n",
                projectId, summary.scannedComponents(), summary.newFindings());
    }
}
