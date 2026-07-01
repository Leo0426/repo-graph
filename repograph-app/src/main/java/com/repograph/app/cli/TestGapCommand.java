package com.repograph.app.cli;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.util.List;

/**
 * CLI: {@code repograph testgap <projectId> [--json]}
 *
 * <p>列出项目中没有任何测试覆盖路径的生产方法（测试空白）。
 * 从所有测试单元出发，沿调用链向下遍历（深度 ≤ 6），
 * 返回不可达的生产代码单元列表。
 *
 * @author leolu
 * @since 0.6.0
 */
@Command(
        name = "testgap",
        mixinStandardHelpOptions = true,
        description = "检测测试空白：在调用图中无任何测试单元可达路径的生产方法"
)
@Component
public class TestGapCommand implements Runnable {

    private final GraphDiagnosticsService graphQueryService;
    private final ObjectMapper objectMapper;

    @Parameters(index = "0", description = "项目 ID")
    private String projectId;

    @Option(names = "--json", description = "输出 JSON 数组")
    private boolean json;

    public TestGapCommand(GraphDiagnosticsService graphQueryService, ObjectMapper objectMapper) {
        this.graphQueryService = graphQueryService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        List<CodeUnit> gaps = graphQueryService.findTestGaps(projectId);

        if (gaps.isEmpty()) {
            System.out.println("No test gaps found — all production methods appear to be covered.");
            return;
        }

        System.err.printf("Found %d method(s) with no test coverage path in project %s%n",
                gaps.size(), projectId);

        if (json) {
            try {
                System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(
                        gaps.stream().map(u -> java.util.Map.of(
                                "qualifiedName", u.qualifiedName(),
                                "filePath", u.filePath() == null ? "" : u.filePath(),
                                "startLine", u.startLine(),
                                "kind", u.kind().name()
                        )).toList()));
            } catch (JsonProcessingException e) {
                System.err.println("JSON serialization error: " + e.getMessage());
                System.exit(1);
            }
            return;
        }

        System.out.printf("%-8s  %-50s  %s%n", "KIND", "QUALIFIED NAME", "LOCATION");
        System.out.println("-".repeat(100));
        for (CodeUnit u : gaps) {
            System.out.printf("%-8s  %-50s  %s:%d%n",
                    u.kind(),
                    truncate(u.qualifiedName(), 50),
                    u.filePath() == null ? "?" : u.filePath(),
                    u.startLine());
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) return "?";
        if (s.length() <= max) return s;
        return "…" + s.substring(s.length() - (max - 1));
    }
}
