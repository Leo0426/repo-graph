package com.repograph.app.cli;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectStats;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Parameters;

import java.util.Map;

/**
 * {@code repograph stats} 子命令，打印指定项目的图谱统计概览。
 *
 * @author leolu
 * @since 0.4.0
 */
@Command(
        name = "stats",
        mixinStandardHelpOptions = true,
        description = "打印指定项目的节点 / 文件 / 边类型聚合统计"
)
@Component
public class StatsCommand implements Runnable {

    @Parameters(index = "0", description = "12 字符 projectId")
    private String projectId;

    private final GraphQueryService graphQueryService;

    public StatsCommand(GraphQueryService graphQueryService) {
        this.graphQueryService = graphQueryService;
    }

    @Override
    public void run() {
        ProjectStats s = graphQueryService.projectStats(projectId);

        if (s.totalUnits() == 0 && s.totalFiles() == 0) {
            System.out.println("No data found for project '" + projectId + "'.");
            System.out.println("Run 'repograph index <path>' first, or check the projectId with 'repograph projects'.");
            return;
        }

        System.out.println("Project:  " + s.projectId());
        System.out.println("Root:     " + (s.projectRoot().isEmpty() ? "(unknown)" : s.projectRoot()));
        System.out.printf("Units:    %,d   Files: %,d   Edges: %,d%n",
                s.totalUnits(), s.totalFiles(), s.totalEdges());
        System.out.printf("Entry pts: %,d   Tests: %,d%n", s.entryPointCount(), s.testCount());

        printDist("By Kind",      s.kindDistribution(),      s.totalUnits());
        printDist("By Language",  s.languageDistribution(),  s.totalUnits());
        printDist("By Framework", s.frameworkDistribution(), sum(s.frameworkDistribution()));
        printDist("By Edge Type", s.edgeKindDistribution(),  s.totalEdges());
    }

    private static void printDist(String header, Map<String, Long> dist, long total) {
        if (dist == null || dist.isEmpty()) return;
        System.out.println();
        System.out.printf("── %s %s%n", header, "─".repeat(Math.max(0, 40 - header.length())));
        long max = dist.values().stream().mapToLong(Long::longValue).max().orElse(1);
        for (Map.Entry<String, Long> e : dist.entrySet()) {
            int bars = (int) Math.round(20.0 * e.getValue() / max);
            double pct = total > 0 ? 100.0 * e.getValue() / total : 0;
            System.out.printf("  %-16s %,6d  %s%s  %5.1f%%%n",
                    e.getKey(), e.getValue(),
                    "█".repeat(bars), "░".repeat(20 - bars),
                    pct);
        }
    }

    private static long sum(Map<String, Long> map) {
        if (map == null) return 0;
        return map.values().stream().mapToLong(Long::longValue).sum();
    }
}
