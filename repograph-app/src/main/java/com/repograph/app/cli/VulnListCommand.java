package com.repograph.app.cli;

import com.repograph.vuln.VulnFinding;
import com.repograph.vuln.VulnStore;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.util.List;

/**
 * {@code repograph vuln list <projectId>} — 列出发现记录，支持按严重程度和状态过滤。
 *
 * @author leolu
 * @since 0.5.0
 */
@Command(
    name = "list",
    mixinStandardHelpOptions = true,
    description = "列出项目漏洞发现记录"
)
@Component
public class VulnListCommand implements Runnable {

    @Parameters(index = "0", description = "项目 ID（12 字符前缀）")
    private String projectId;

    @Option(names = {"--severity", "-s"},
            description = "严重程度过滤：CRITICAL / HIGH / MEDIUM / LOW")
    private String severity;

    @Option(names = {"--status", "-S"},
            description = "状态过滤：SUSPECTED / CONFIRMED / FIXED / DISMISSED")
    private String status;

    private final VulnStore vulnStore;

    public VulnListCommand(VulnStore vulnStore) {
        this.vulnStore = vulnStore;
    }

    @Override
    public void run() {
        List<VulnFinding> findings = vulnStore.list(projectId, severity, status);
        if (findings.isEmpty()) {
            System.err.println("No findings for project: " + projectId);
            return;
        }

        // 表头
        System.err.printf("%-10s %-12s %-10s %-22s %s%n",
                "SEVERITY", "STATUS", "CWE", "RULE", "TITLE");
        System.err.println("-".repeat(90));

        for (VulnFinding f : findings) {
            System.out.printf("%-10s %-12s %-10s %-22s %s%n",
                    f.severity(),
                    f.status(),
                    nvl(f.cwe()),
                    f.ruleId(),
                    f.title());
            System.out.printf("           %s  %s:%d%n",
                    f.qualifiedName(), f.filePath(), f.startLine());
            System.out.println();
        }
        System.err.printf("Total: %d finding(s)%n", findings.size());
    }

    private static String nvl(String s) { return s == null ? "" : s; }
}
