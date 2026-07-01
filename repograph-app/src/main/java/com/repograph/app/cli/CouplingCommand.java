package com.repograph.app.cli;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.metrics.CouplingAnalyzer;
import com.repograph.metrics.CouplingMetric;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.util.List;

/**
 * CLI: {@code repograph coupling <projectId> [--sort fanout|fanin] [--limit 20] [--json]}
 *
 * <p>输出类级别传入/传出耦合度（Robert Martin Ca/Ce/I 指标），按指定维度降序排列。
 *
 * @author leolu
 * @since 0.6.0
 */
@Command(
        name = "coupling",
        mixinStandardHelpOptions = true,
        description = "分析类级别耦合度：传出耦合（Ce）、传入耦合（Ca）与不稳定性系数（I）"
)
@Component
public class CouplingCommand implements Runnable {

    private final CouplingAnalyzer couplingAnalyzer;
    private final ObjectMapper objectMapper;

    @Parameters(index = "0", description = "项目 ID")
    private String projectId;

    @Option(names = "--sort", defaultValue = "fanout",
            description = "排序维度：fanout（传出耦合，默认）或 fanin（传入耦合）")
    private String sort;

    @Option(names = "--limit", defaultValue = "20",
            description = "最大返回数量（默认 20，上限 100）")
    private int limit;

    @Option(names = "--json", description = "输出 JSON 数组")
    private boolean json;

    public CouplingCommand(CouplingAnalyzer couplingAnalyzer, ObjectMapper objectMapper) {
        this.couplingAnalyzer = couplingAnalyzer;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        int effectiveLimit = Math.min(Math.max(1, limit), 100);
        List<CouplingMetric> metrics = "fanin".equalsIgnoreCase(sort)
                ? couplingAnalyzer.topByFanIn(projectId, effectiveLimit)
                : couplingAnalyzer.topByFanOut(projectId, effectiveLimit);

        if (json) {
            try {
                System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(metrics));
            } catch (JsonProcessingException e) {
                System.err.println("JSON serialization error: " + e.getMessage());
                System.exit(1);
            }
            return;
        }

        if (metrics.isEmpty()) {
            System.out.println("No coupling data found (check projectId or run indexing first).");
            return;
        }

        String sortLabel = "fanin".equalsIgnoreCase(sort) ? "Ca (Fan-in)" : "Ce (Fan-out)";
        System.out.printf("%-6s  %-6s  %-6s  %s%n", "Ce", "Ca", "I", "Class");
        System.out.println("-".repeat(90));

        for (CouplingMetric m : metrics) {
            String shortName = m.classQualifiedName() == null ? "?"
                    : m.classQualifiedName().contains(".")
                    ? m.classQualifiedName().substring(m.classQualifiedName().lastIndexOf('.') + 1)
                    : m.classQualifiedName();
            String risk = m.instability() >= 0.8 ? " [UNSTABLE]"
                    : m.instability() >= 0.5 ? " [MOD]" : "";
            System.out.printf("%-6d  %-6d  %-6.3f  %s  (%s)%s%n",
                    m.fanOut(), m.fanIn(), m.instability(),
                    truncate(shortName, 40), truncate(m.classQualifiedName(), 50),
                    risk);
        }
        System.err.printf("%nSorted by: %s  ·  %d classes shown%n", sortLabel, metrics.size());
    }

    private static String truncate(String s, int max) {
        if (s == null) return "?";
        if (s.length() <= max) return s;
        return "…" + s.substring(s.length() - (max - 1));
    }
}
