package com.repograph.app.cli;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.metrics.PackageCycle;
import com.repograph.metrics.PackageCycleDetector;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.util.List;

/**
 * CLI: {@code repograph cycles <projectId> [--json]}
 *
 * <p>检测项目包级别循环依赖，使用 Tarjan 强连通分量算法。
 * 循环依赖会阻碍模块化和增量编译，应优先消除。
 *
 * @author leolu
 * @since 0.6.0
 */
@Command(
        name = "cycles",
        mixinStandardHelpOptions = true,
        description = "检测包级别循环依赖（Tarjan SCC 算法），输出所有互相循环引用的包组"
)
@Component
public class CyclesCommand implements Runnable {

    private final PackageCycleDetector cycleDetector;
    private final ObjectMapper objectMapper;

    @Parameters(index = "0", description = "项目 ID")
    private String projectId;

    @Option(names = "--json", description = "输出 JSON 数组")
    private boolean json;

    public CyclesCommand(PackageCycleDetector cycleDetector, ObjectMapper objectMapper) {
        this.cycleDetector = cycleDetector;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        List<PackageCycle> cycles = cycleDetector.findCycles(projectId);

        if (json) {
            try {
                System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(cycles));
            } catch (JsonProcessingException e) {
                System.err.println("JSON serialization error: " + e.getMessage());
                System.exit(1);
            }
            return;
        }

        if (cycles.isEmpty()) {
            System.out.println("No package cycles detected. Architecture looks clean.");
            return;
        }

        System.err.printf("Found %d package cycle(s) in project %s%n", cycles.size(), projectId);
        System.out.println();

        for (int i = 0; i < cycles.size(); i++) {
            PackageCycle cycle = cycles.get(i);
            List<String> pkgs = cycle.packages().stream().sorted().toList();
            System.out.printf("Cycle #%d  (%d packages):%n", i + 1, pkgs.size());
            System.out.println("  " + String.join(" ↔ ", pkgs));
            System.out.println();
        }

        System.err.printf("Tip: eliminate cycles by extracting shared abstractions to a lower-level package.%n");
    }
}
