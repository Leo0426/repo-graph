package com.repograph.app.cli;

import com.repograph.vuln.CodeVulnScanner;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Parameters;

/**
 * {@code repograph vuln scan-code <projectId>} — 对项目所有方法/函数运行内置静态规则。
 *
 * @author leolu
 * @since 0.5.0
 */
@Command(
    name = "scan-code",
    mixinStandardHelpOptions = true,
    description = "对项目代码运行静态漏洞规则扫描（SQL 注入 / 命令注入 / 路径穿越等）"
)
@Component
public class VulnScanCodeCommand implements Runnable {

    @Parameters(index = "0", description = "项目 ID（12 字符前缀）")
    private String projectId;

    private final CodeVulnScanner scanner;

    public VulnScanCodeCommand(CodeVulnScanner scanner) {
        this.scanner = scanner;
    }

    @Override
    public void run() {
        System.err.printf("Scanning code for project: %s%n", projectId);
        CodeVulnScanner.ScanSummary summary = scanner.scan(projectId);
        System.err.printf("Done. Scanned %d units, %d finding(s) written.%n",
                summary.scannedUnits(), summary.newFindings());
        System.out.printf("{\"projectId\":\"%s\",\"scannedUnits\":%d,\"newFindings\":%d}%n",
                projectId, summary.scannedUnits(), summary.newFindings());
    }
}
