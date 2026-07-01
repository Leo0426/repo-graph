package com.repograph.app.cli;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.metrics.ComplexityMetric;
import com.repograph.metrics.CouplingMetric;
import com.repograph.metrics.HealthReport;
import com.repograph.metrics.HealthReportService;
import com.repograph.metrics.PackageCycle;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

/**
 * CLI: {@code repograph report <projectId> [--json] [--out <file>]}
 *
 * <p>生成六维度项目代码健康报告，汇总漏洞、圈复杂度、类耦合、包循环、死代码和测试空白，
 * 计算综合健康分（0–100）。默认输出 Markdown，可选 JSON 或写入文件。
 *
 * @author leolu
 * @since 0.6.0
 */
@Command(
        name = "report",
        mixinStandardHelpOptions = true,
        description = "生成项目代码健康报告（六维度综合分析 + 健康分）"
)
@Component
public class ReportCommand implements Runnable {

    private final HealthReportService reportService;
    private final ObjectMapper objectMapper;

    @Parameters(index = "0", description = "项目 ID")
    private String projectId;

    @Option(names = "--json", description = "以 JSON 格式输出报告")
    private boolean json;

    @Option(names = {"--out", "-o"}, description = "将 Markdown 报告写入指定文件路径")
    private Path outFile;

    public ReportCommand(HealthReportService reportService, ObjectMapper objectMapper) {
        this.reportService = reportService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        HealthReport report = reportService.generate(projectId);

        if (json) {
            try {
                System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(report));
            } catch (JsonProcessingException e) {
                System.err.println("JSON serialization error: " + e.getMessage());
                System.exit(1);
            }
            return;
        }

        String markdown = toMarkdown(report);

        if (outFile != null) {
            try {
                Files.writeString(outFile, markdown, StandardCharsets.UTF_8);
                System.err.printf("Report written to %s%n", outFile.toAbsolutePath());
            } catch (IOException e) {
                System.err.printf("Failed to write report: %s%n", e.getMessage());
                System.exit(1);
            }
        } else {
            System.out.println(markdown);
        }
    }

    // ── Markdown 构建器 ───────────────────────────────────────────────────────

    static String toMarkdown(HealthReport r) {
        StringBuilder sb = new StringBuilder(2048);
        String grade = grade(r.healthScore());
        long totalVulns = r.vulnCritical() + r.vulnHigh() + r.vulnMedium() + r.vulnLow();

        sb.append("# RepoGraph 项目健康报告\n\n");
        sb.append("| 字段 | 值 |\n");
        sb.append("|------|----|\n");
        sb.append(String.format("| 项目 ID | `%s` |%n", r.projectId()));
        sb.append(String.format("| 根目录 | `%s` |%n", r.projectRoot()));
        sb.append(String.format("| 生成时间 | `%s` |%n", r.generatedAt()));
        sb.append(String.format("| **健康分** | **%d / 100 %s** |%n", r.healthScore(), grade));
        sb.append("\n---\n\n");

        // ── 总览 ──
        sb.append("## 一览\n\n");
        sb.append("| 维度 | 数量 | 评估 |\n");
        sb.append("|------|------:|------|\n");
        appendRow(sb, "活跃漏洞（HIGH+）", totalVulns, r.vulnHigh() + r.vulnCritical() > 0 ? "🔴 需修复" : totalVulns > 0 ? "🟡 待确认" : "✅ 无");
        appendRow(sb, "CC>10 高复杂方法", r.highComplexityMethods(), r.highComplexityMethods() > 5 ? "🔴 过多" : r.highComplexityMethods() > 0 ? "🟡 存在" : "✅ 无");
        appendRow(sb, "高不稳定类 (I>0.8)", r.highInstabilityClasses(), r.highInstabilityClasses() > 10 ? "🔴 过多" : r.highInstabilityClasses() > 0 ? "🟡 存在" : "✅ 无");
        appendRow(sb, "包循环依赖", r.packageCycles(), r.packageCycles() > 0 ? "🔴 存在" : "✅ 无");
        appendRow(sb, "疑似死代码", r.deadCodeCount(), r.deadCodeCount() > 0 ? "🟡 待核查" : "✅ 无");
        String gapPct = r.totalProductionMethods() > 0
                ? String.format(Locale.ROOT, "%.0f%%", 100.0 * r.testGapCount() / r.totalProductionMethods())
                : "N/A";
        appendRow(sb, "测试空白率", r.testGapCount() + " / " + r.totalProductionMethods() + " (" + gapPct + ")",
                r.totalProductionMethods() > 0 && r.testGapCount() * 100 / r.totalProductionMethods() > 50 ? "🟡 偏高" : "✅ 可接受");
        sb.append("\n");

        // ── 圈复杂度 Top 5 ──
        sb.append("## 圈复杂度 Top 5\n\n");
        if (r.topComplexMethods().isEmpty()) {
            sb.append("_暂无方法圈复杂度数据。_\n\n");
        } else {
            sb.append("| CC | 风险 | 方法 | 文件:行 |\n");
            sb.append("|----|------|------|--------|\n");
            for (ComplexityMetric m : r.topComplexMethods()) {
                String risk = m.complexity() >= 10 ? "HIGH" : m.complexity() >= 6 ? "MED" : "LOW";
                sb.append(String.format("| %d | %s | `%s` | `%s:%d` |%n",
                        m.complexity(), risk, m.qualifiedName(), m.filePath(), m.startLine()));
            }
            sb.append("\n");
        }

        // ── 耦合度 Top 5 ──
        sb.append("## 高不稳定类 Top 5\n\n");
        if (r.topInstableCouplings().isEmpty()) {
            sb.append("_暂无耦合度数据。_\n\n");
        } else {
            sb.append("| I | Ce (fan-out) | Ca (fan-in) | 类 |\n");
            sb.append("|---|------------:|------------:|-----|\n");
            for (CouplingMetric c : r.topInstableCouplings()) {
                sb.append(String.format("| %.3f | %d | %d | `%s` |%n",
                        c.instability(), c.fanOut(), c.fanIn(), c.classQualifiedName()));
            }
            sb.append("\n");
        }

        // ── 包循环 ──
        sb.append("## 包循环依赖\n\n");
        if (r.packageCycleList().isEmpty()) {
            sb.append("_无循环依赖，模块结构健康。_ ✅\n\n");
        } else {
            int shown = r.packageCycleList().size();
            if (r.packageCycles() > shown) {
                sb.append(String.format("_共 %d 个包循环，以下展示前 %d 个：_%n%n", r.packageCycles(), shown));
            }
            for (int i = 0; i < r.packageCycleList().size(); i++) {
                PackageCycle c = r.packageCycleList().get(i);
                List<String> pkgs = c.packages().stream().sorted().toList();
                sb.append(String.format("**Cycle #%d** (%d 个包)：`%s`%n%n",
                        i + 1, pkgs.size(), String.join(" ↔ ", pkgs)));
            }
        }

        // ── 漏洞 ──
        sb.append("## 漏洞概览\n\n");
        if (totalVulns == 0) {
            sb.append("_无活跃漏洞（SUSPECTED/CONFIRMED）。_ ✅\n\n");
        } else {
            sb.append(String.format("共 **%d** 条活跃漏洞（SUSPECTED + CONFIRMED）%n%n", totalVulns));
            sb.append("| 严重度 | 数量 |\n");
            sb.append("|--------|------:|\n");
            if (r.vulnCritical() > 0) sb.append(String.format("| CRITICAL | %d |%n", r.vulnCritical()));
            sb.append(String.format("| HIGH | %d |%n", r.vulnHigh()));
            sb.append(String.format("| MEDIUM | %d |%n", r.vulnMedium()));
            sb.append(String.format("| LOW | %d |%n", r.vulnLow()));
            sb.append("\n");
        }

        // ── 代码库统计 ──
        sb.append("## 代码库规模\n\n");
        sb.append("| 指标 | 数量 |\n");
        sb.append("|------|------:|\n");
        sb.append(String.format("| 代码单元 | %d |%n", r.totalUnits()));
        sb.append(String.format("| 源文件 | %d |%n", r.totalFiles()));
        sb.append(String.format("| 调用边 | %d |%n", r.totalEdges()));
        sb.append("\n");

        sb.append("---\n\n");
        sb.append("> 由 **RepoGraph** 自动生成 · 完全本地 · 数据零上云\n");

        return sb.toString();
    }

    private static void appendRow(StringBuilder sb, String label, long count, String status) {
        sb.append(String.format("| %s | %d | %s |%n", label, count, status));
    }

    private static void appendRow(StringBuilder sb, String label, String count, String status) {
        sb.append(String.format("| %s | %s | %s |%n", label, count, status));
    }

    private static String grade(int score) {
        if (score >= 90) return "A ✅";
        if (score >= 75) return "B 🟡";
        if (score >= 60) return "C 🟠";
        return "D 🔴";
    }
}
