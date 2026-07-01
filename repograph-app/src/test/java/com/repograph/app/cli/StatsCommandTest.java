package com.repograph.app.cli;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectStats;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@link StatsCommand} 单元测试，验证统计输出格式和边界情况。
 *
 * @author leolu
 * @since 0.4.0
 */
@ExtendWith(MockitoExtension.class)
class StatsCommandTest {

    @Mock
    GraphQueryService graphQueryService;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new StatsCommand(graphQueryService));
    }

    private String captureOut(Runnable action) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        PrintStream old = System.out;
        System.setOut(new PrintStream(buf));
        try { action.run(); } finally { System.setOut(old); }
        return buf.toString();
    }

    private static ProjectStats stats(long units, long files, long edges) {
        Map<String, Long> kinds = new LinkedHashMap<>();
        kinds.put("METHOD", 80L);
        kinds.put("CLASS", 20L);
        return new ProjectStats(
                "abc123def456", "/Users/leo/proj",
                units, files, edges, 5L, 3L,
                kinds,
                Map.of("java", units),
                Map.of("spring", 5L),
                Map.of("CALLS", edges));
    }

    // ── happy path ────────────────────────────────────────────────────────────

    @Test
    void run_printsProjectIdAndRoot() {
        when(graphQueryService.projectStats("abc123def456")).thenReturn(stats(100, 12, 200));

        String out = captureOut(() -> cli.execute("abc123def456"));

        assertThat(out).contains("abc123def456").contains("/Users/leo/proj");
    }

    @Test
    void run_printsSummaryCounts() {
        when(graphQueryService.projectStats("abc123def456")).thenReturn(stats(245, 42, 1203));

        String out = captureOut(() -> cli.execute("abc123def456"));

        assertThat(out).contains("245").contains("42").contains("1,203");
        assertThat(out).contains("Entry pts:").contains("Tests:");
    }

    @Test
    void run_printsKindDistributionSection() {
        when(graphQueryService.projectStats("abc123def456")).thenReturn(stats(100, 10, 50));

        String out = captureOut(() -> cli.execute("abc123def456"));

        assertThat(out).contains("By Kind").contains("METHOD").contains("CLASS");
    }

    @Test
    void run_printsBarChart() {
        when(graphQueryService.projectStats("abc123def456")).thenReturn(stats(100, 10, 50));

        String out = captureOut(() -> cli.execute("abc123def456"));

        assertThat(out).contains("█").contains("░").contains("%");
    }

    @Test
    void run_emptyRoot_showsUnknown() {
        ProjectStats s = new ProjectStats("abc123def456", "", 10L, 2L, 5L, 0L, 0L,
                Map.of(), Map.of(), Map.of(), Map.of());
        when(graphQueryService.projectStats("abc123def456")).thenReturn(s);

        String out = captureOut(() -> cli.execute("abc123def456"));

        assertThat(out).contains("(unknown)");
    }

    // ── no data ───────────────────────────────────────────────────────────────

    @Test
    void run_noData_printsHelpfulMessage() {
        ProjectStats empty = new ProjectStats("abc123def456", "", 0L, 0L, 0L, 0L, 0L,
                Map.of(), Map.of(), Map.of(), Map.of());
        when(graphQueryService.projectStats("abc123def456")).thenReturn(empty);

        String out = captureOut(() -> cli.execute("abc123def456"));

        assertThat(out).contains("No data found").contains("repograph index").contains("repograph projects");
    }

    // ── empty distributions ───────────────────────────────────────────────────

    @Test
    void run_emptyFrameworkDistribution_skipsSection() {
        ProjectStats s = new ProjectStats("abc123def456", "/root", 10L, 2L, 5L, 0L, 0L,
                Map.of("METHOD", 10L), Map.of("java", 10L), Map.of(), Map.of("CALLS", 5L));
        when(graphQueryService.projectStats("abc123def456")).thenReturn(s);

        String out = captureOut(() -> cli.execute("abc123def456"));

        // Framework section absent (empty map)
        assertThat(out).doesNotContain("By Framework");
        // Other sections present
        assertThat(out).contains("By Kind").contains("By Language").contains("By Edge Type");
    }
}
