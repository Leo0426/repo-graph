package com.repograph.app.cli;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.metrics.GitChurnAnalyzer;
import com.repograph.metrics.HotspotMetric;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.util.List;

/**
 * CLI: {@code repograph hotspots <projectId> [--limit 10] [--json]}
 *
 * <p>结合 Git 提交频率与圈复杂度，识别最需要重构的"热点"文件。
 * 热点分 = ln(变更次数 + 1) × 平均 CC，高热点分 = 高风险。
 *
 * <p>若项目不在 Git 仓库中，或尚未完成代码索引，将输出提示信息并正常退出。
 *
 * @author leolu
 * @since 0.7.0
 */
@Command(
        name = "hotspots",
        mixinStandardHelpOptions = true,
        description = "Git 变更频率 × 圈复杂度热点分析——识别最需重构的文件"
)
@Component
public class HotspotsCommand implements Runnable {

    private final GitChurnAnalyzer gitChurnAnalyzer;
    private final ObjectMapper objectMapper;

    @Parameters(index = "0", description = "项目 ID")
    private String projectId;

    @Option(names = {"--limit", "-n"}, description = "显示热点数量（默认 10，最大 50）", defaultValue = "10")
    private int limit;

    @Option(names = "--json", description = "以 JSON 格式输出")
    private boolean json;

    public HotspotsCommand(GitChurnAnalyzer gitChurnAnalyzer, ObjectMapper objectMapper) {
        this.gitChurnAnalyzer = gitChurnAnalyzer;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        List<HotspotMetric> hotspots = gitChurnAnalyzer.topHotspots(projectId, Math.min(limit, 50));

        if (json) {
            try {
                System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(hotspots));
            } catch (JsonProcessingException e) {
                System.err.println("JSON serialization error: " + e.getMessage());
                System.exit(1);
            }
            return;
        }

        if (hotspots.isEmpty()) {
            System.out.println("No hotspot data available. Ensure the project is in a Git repo and has been indexed.");
            return;
        }

        System.err.printf("Top %d code hotspots in project %s (last 1000 commits)%n%n",
                hotspots.size(), projectId);
        System.out.printf("%-6s %-7s %-6s %-7s  %s%n", "Score", "Churn", "AvgCC", "Methods", "File");
        System.out.println("─".repeat(72));

        for (HotspotMetric h : hotspots) {
            String risk = h.hotspotScore() >= 20 ? " !!!" : h.hotspotScore() >= 10 ? " !" : "";
            String shortFile = h.filePath().contains("/")
                    ? h.filePath().substring(h.filePath().lastIndexOf('/') + 1)
                    : h.filePath();
            System.out.printf("%-6.1f %-7d %-6.1f %-7d  %s%s%n",
                    h.hotspotScore(), h.churnCount(), h.avgComplexity(), h.methodCount(),
                    shortFile, risk);
        }

        System.out.println();
        System.err.println("Tip: hotspot = ln(churn+1) × avgCC. High-score files are candidates for");
        System.err.println("     test hardening and modular decomposition.");
    }
}
