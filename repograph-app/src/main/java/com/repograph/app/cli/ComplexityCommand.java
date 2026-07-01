package com.repograph.app.cli;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.metrics.ComplexityAnalyzer;
import com.repograph.metrics.ComplexityMetric;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.util.List;

/**
 * CLI: {@code repograph complexity <projectId> [--limit 20] [--json]}
 *
 * <p>按圈复杂度降序列出项目中最复杂的方法。
 *
 * @author leolu
 * @since 0.6.0
 */
@Command(
        name = "complexity",
        mixinStandardHelpOptions = true,
        description = "列出项目中圈复杂度最高的方法"
)
@Component
public class ComplexityCommand implements Runnable {

    private final ComplexityAnalyzer complexityAnalyzer;
    private final ObjectMapper objectMapper;

    @Parameters(index = "0", description = "项目 ID")
    private String projectId;

    @Option(names = "--limit", defaultValue = "20", description = "最大返回数量（默认 20，上限 100）")
    private int limit;

    @Option(names = "--json", description = "输出 JSON 数组")
    private boolean json;

    public ComplexityCommand(ComplexityAnalyzer complexityAnalyzer, ObjectMapper objectMapper) {
        this.complexityAnalyzer = complexityAnalyzer;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        int effectiveLimit = Math.min(Math.max(1, limit), 100);
        List<ComplexityMetric> metrics = complexityAnalyzer.topComplex(projectId, effectiveLimit);

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
            System.out.println("No methods found (check projectId or run indexing first).");
            return;
        }

        // 表头
        System.out.printf("%-6s  %-10s  %-50s  %s%n", "CC", "Kind", "Method", "File:Line");
        System.out.println("-".repeat(100));

        for (ComplexityMetric m : metrics) {
            String cc = String.valueOf(m.complexity());
            String risk = m.complexity() >= 10 ? " [HIGH]" : m.complexity() >= 6 ? " [MED]" : "";
            String method = truncate(m.qualifiedName(), 50);
            String location = truncate((m.filePath() == null ? "?" : m.filePath()), 40) + ":" + m.startLine();
            System.out.printf("%-6s  %-10s  %-50s  %s%s%n", cc, m.kind(), method, location, risk);
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) return "?";
        if (s.length() <= max) return s;
        return "…" + s.substring(s.length() - (max - 1));
    }
}
