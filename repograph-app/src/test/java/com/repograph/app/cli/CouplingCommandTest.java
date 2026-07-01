package com.repograph.app.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.metrics.CouplingAnalyzer;
import com.repograph.metrics.CouplingMetric;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link CouplingCommand} 单元测试，验证文本表格、JSON 输出与排序选项。
 *
 * @author leolu
 * @since 0.6.0
 */
@ExtendWith(MockitoExtension.class)
class CouplingCommandTest {

    @Mock
    CouplingAnalyzer couplingAnalyzer;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new CouplingCommand(couplingAnalyzer, new ObjectMapper()));
    }

    private static CouplingMetric metric(String cls, int fanOut, int fanIn, double instability) {
        return new CouplingMetric(cls, fanIn, fanOut, instability);
    }

    private String captureOut(Runnable action) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        PrintStream old = System.out;
        System.setOut(new PrintStream(buf));
        try { action.run(); } finally { System.setOut(old); }
        return buf.toString();
    }

    // ── Default: sort by fanout ───────────────────────────────────────────────

    @Test
    void run_defaultSort_callsTopByFanOut() {
        when(couplingAnalyzer.topByFanOut("proj-a", 20)).thenReturn(List.of());

        cli.execute("proj-a");

        verify(couplingAnalyzer).topByFanOut("proj-a", 20);
    }

    @Test
    void run_fanoutSort_explicit_callsTopByFanOut() {
        when(couplingAnalyzer.topByFanOut("proj-a", 20)).thenReturn(List.of());

        cli.execute("proj-a", "--sort", "fanout");

        verify(couplingAnalyzer).topByFanOut("proj-a", 20);
    }

    @Test
    void run_faninSort_callsTopByFanIn() {
        when(couplingAnalyzer.topByFanIn("proj-a", 20)).thenReturn(List.of());

        cli.execute("proj-a", "--sort", "fanin");

        verify(couplingAnalyzer).topByFanIn("proj-a", 20);
    }

    // ── Text table output ─────────────────────────────────────────────────────

    @Test
    void run_tableFormat_printsHeader() {
        when(couplingAnalyzer.topByFanOut("proj-a", 20))
                .thenReturn(List.of(metric("com.example.Service", 5, 2, 0.714)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("Ce").contains("Ca").contains("I").contains("Class");
    }

    @Test
    void run_tableFormat_printsMetricRow() {
        when(couplingAnalyzer.topByFanOut("proj-a", 20))
                .thenReturn(List.of(metric("com.example.OrderService", 8, 3, 0.727)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("8").contains("3").contains("OrderService");
    }

    @Test
    void run_highInstability_showsUnstableMarker() {
        when(couplingAnalyzer.topByFanOut("proj-a", 20))
                .thenReturn(List.of(metric("com.example.Messy", 10, 0, 1.0)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("[UNSTABLE]");
    }

    @Test
    void run_moderateInstability_showsModMarker() {
        when(couplingAnalyzer.topByFanOut("proj-a", 20))
                .thenReturn(List.of(metric("com.example.Middle", 6, 4, 0.6)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("[MOD]");
    }

    @Test
    void run_noData_printsNotFoundMessage() {
        when(couplingAnalyzer.topByFanOut("proj-a", 20)).thenReturn(List.of());

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("No coupling data found");
    }

    // ── JSON format ───────────────────────────────────────────────────────────

    @Test
    void run_jsonFlag_printsJsonArray() {
        when(couplingAnalyzer.topByFanOut("proj-a", 20))
                .thenReturn(List.of(
                        metric("com.example.A", 5, 2, 0.714),
                        metric("com.example.B", 3, 1, 0.75)));

        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        assertThat(out.trim()).startsWith("[").endsWith("]");
        assertThat(out).contains("classQualifiedName").contains("fanOut").contains("fanIn");
    }

    // ── Limit handling ────────────────────────────────────────────────────────

    @Test
    void run_customLimit_passedToAnalyzer() {
        when(couplingAnalyzer.topByFanOut("proj-a", 5)).thenReturn(List.of());

        cli.execute("proj-a", "--limit", "5");

        verify(couplingAnalyzer).topByFanOut("proj-a", 5);
    }

    @Test
    void run_limitOver100_cappedAt100() {
        when(couplingAnalyzer.topByFanOut("proj-a", 100)).thenReturn(List.of());

        cli.execute("proj-a", "--limit", "500");

        verify(couplingAnalyzer).topByFanOut("proj-a", 100);
    }
}
