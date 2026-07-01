package com.repograph.app.cli;

import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.util.List;

/**
 * {@code repograph deadcode <projectId>} — 检测图中无任何调用方且非入口点的方法/函数。
 *
 * <p>基于调用图拓扑分析，结果属于启发式，反射调用等动态场景可能造成误报，需人工复核。
 *
 * @author leolu
 * @since 0.5.0
 */
@Command(
    name = "deadcode",
    mixinStandardHelpOptions = true,
    description = "检测疑似死代码：在调用图中无任何调用方且非入口点的方法/函数"
)
@Component
public class DeadCodeCommand implements Runnable {

    @Parameters(index = "0", description = "项目 ID（12 字符前缀）")
    private String projectId;

    @Option(names = {"--json"}, description = "以 JSON 格式输出（默认文本表格）")
    private boolean json;

    private final GraphDiagnosticsService graphQueryService;

    public DeadCodeCommand(GraphDiagnosticsService graphQueryService) {
        this.graphQueryService = graphQueryService;
    }

    @Override
    public void run() {
        List<CodeUnit> dead = graphQueryService.findDeadCode(projectId);
        if (dead.isEmpty()) {
            System.err.println("No dead code found for project: " + projectId);
            return;
        }

        System.err.printf("Found %d suspected dead code unit(s) in project %s%n",
                dead.size(), projectId);

        if (json) {
            System.out.println("[");
            for (int i = 0; i < dead.size(); i++) {
                CodeUnit u = dead.get(i);
                System.out.printf("  {\"qualifiedName\":\"%s\",\"filePath\":\"%s\",\"startLine\":%d,\"kind\":\"%s\"}%s%n",
                        u.qualifiedName(), u.filePath(), u.startLine(), u.kind(),
                        i < dead.size() - 1 ? "," : "");
            }
            System.out.println("]");
        } else {
            System.err.printf("%-8s %-50s %s%n", "KIND", "QUALIFIED NAME", "LOCATION");
            System.err.println("-".repeat(100));
            for (CodeUnit u : dead) {
                System.out.printf("%-8s %-50s %s:%d%n",
                        u.kind(),
                        truncate(u.qualifiedName(), 50),
                        u.filePath(),
                        u.startLine());
            }
        }
    }

    private static String truncate(String s, int max) {
        return s == null ? "" : s.length() <= max ? s : "…" + s.substring(s.length() - max + 1);
    }
}
