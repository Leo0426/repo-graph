package com.repograph.app.cli;

import com.repograph.vuln.VulnFinding;
import com.repograph.vuln.VulnStore;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * {@code repograph vuln report <projectId>} — 生成 Markdown 格式漏洞报告，
 * 输出到 stdout 或 {@code --out} 指定的文件路径。
 *
 * @author leolu
 * @since 0.5.0
 */
@Command(
    name = "report",
    mixinStandardHelpOptions = true,
    description = "生成项目漏洞 Markdown 报告（含统计表 + 已确认发现详情）"
)
@Component
public class VulnReportCommand implements Runnable {

    @Parameters(index = "0", description = "项目 ID（12 字符前缀）")
    private String projectId;

    @Option(names = {"--out", "-o"}, description = "输出文件路径（默认输出到 stdout）")
    private Path outputFile;

    @Option(names = {"--all"}, description = "报告包含全部发现（默认仅含 CONFIRMED）")
    private boolean includeAll;

    private final VulnStore vulnStore;

    public VulnReportCommand(VulnStore vulnStore) {
        this.vulnStore = vulnStore;
    }

    @Override
    public void run() {
        List<VulnFinding> all       = vulnStore.list(projectId, null, null);
        List<VulnFinding> confirmed = vulnStore.list(projectId, null, VulnFinding.CONFIRMED);

        String report = buildMarkdown(all, confirmed);

        if (outputFile != null) {
            try {
                Files.writeString(outputFile, report);
                System.err.printf("Report written to: %s%n", outputFile.toAbsolutePath());
            } catch (IOException e) {
                System.err.println("[ERROR] Failed to write report: " + e.getMessage());
                System.exit(1);
            }
        } else {
            System.out.println(report);
        }
    }

    // ── 报告构建器（对应 JS formatVulnReport）────────────────────────────────

    private String buildMarkdown(List<VulnFinding> all, List<VulnFinding> confirmed) {
        List<VulnFinding> detail = includeAll ? all : confirmed;
        StringBuilder sb = new StringBuilder();

        sb.append("# RepoGraph 漏洞扫描报告\n\n");
        sb.append("| 字段 | 值 |\n");
        sb.append("| ---- | -- |\n");
        sb.append("| 项目 ID | `").append(projectId).append("` |\n");
        sb.append("| 生成时间 | ").append(Instant.now()).append(" |\n");
        sb.append("| 发现总数 | **").append(all.size()).append("** 条 |\n\n");

        appendCountTable(sb, "## 严重程度分布\n\n", "严重程度", all, VulnFinding::severity,
                List.of("CRITICAL", "HIGH", "MEDIUM", "LOW"));
        appendCountTable(sb, "## 状态分布\n\n", "状态", all, VulnFinding::status,
                List.of("SUSPECTED", "CONFIRMED", "FIXED", "DISMISSED"));

        Map<String, Long> byCwe = all.stream()
                .filter(f -> f.cwe() != null && !f.cwe().isBlank())
                .collect(Collectors.groupingBy(VulnFinding::cwe, Collectors.counting()));
        if (!byCwe.isEmpty()) {
            sb.append("## CWE 分布\n\n");
            sb.append("| CWE | 数量 |\n| --- | ---- |\n");
            byCwe.entrySet().stream()
                    .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                    .forEach(e -> sb.append("| ").append(e.getKey())
                            .append(" | ").append(e.getValue()).append(" 条 |\n"));
            sb.append("\n");
        }

        sb.append("## ").append(includeAll ? "全部发现" : "已确认漏洞").append("\n\n");
        if (detail.isEmpty()) {
            sb.append("_无").append(includeAll ? "发现" : "已确认漏洞").append("。_\n\n");
        } else {
            sb.append("| # | 严重程度 | CWE | 规则 | 符号 | 位置 | 详情 |\n");
            sb.append("| - | -------- | --- | ---- | ---- | ---- | ---- |\n");
            for (int i = 0; i < detail.size(); i++) {
                VulnFinding f = detail.get(i);
                sb.append("| ").append(i + 1)
                  .append(" | ").append(f.severity())
                  .append(" | ").append(nvl(f.cwe()))
                  .append(" | ").append(f.ruleId())
                  .append(" | ").append(esc(f.qualifiedName()))
                  .append(" | ").append(f.filePath()).append(":").append(f.startLine())
                  .append(" | ").append(esc(nvl(f.detail())))
                  .append(" |\n");
            }
            sb.append("\n");
        }

        sb.append("---\n\n");
        sb.append("> 由 **RepoGraph** 生成 · 完全本地 · 数据零上云\n");
        return sb.toString();
    }

    private static void appendCountTable(StringBuilder sb, String header, String keyLabel,
            List<VulnFinding> findings,
            java.util.function.Function<VulnFinding, String> keyFn,
            List<String> order) {
        Map<String, Long> counts = findings.stream()
                .collect(Collectors.groupingBy(keyFn, Collectors.counting()));
        sb.append(header);
        if (counts.isEmpty()) { sb.append("_无数据_\n\n"); return; }
        sb.append("| ").append(keyLabel).append(" | 数量 |\n| --- | ---- |\n");
        order.forEach(k -> {
            if (counts.containsKey(k))
                sb.append("| ").append(k).append(" | ").append(counts.get(k)).append(" 条 |\n");
        });
        counts.keySet().stream()
                .filter(k -> !order.contains(k))
                .sorted()
                .forEach(k -> sb.append("| ").append(k).append(" | ").append(counts.get(k)).append(" 条 |\n"));
        sb.append("\n");
    }

    private static String nvl(String s)  { return s == null ? "" : s; }
    private static String esc(String s)  { return s == null ? "" : s.replace("|", "\\|"); }
}
