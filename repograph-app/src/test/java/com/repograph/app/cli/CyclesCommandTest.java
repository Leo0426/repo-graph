package com.repograph.app.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.metrics.PackageCycle;
import com.repograph.metrics.PackageCycleDetector;
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
import static org.mockito.Mockito.when;

/**
 * {@link CyclesCommand} 单元测试，验证循环依赖文本输出与 JSON 两种格式。
 *
 * @author leolu
 * @since 0.6.0
 */
@ExtendWith(MockitoExtension.class)
class CyclesCommandTest {

    @Mock
    PackageCycleDetector cycleDetector;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new CyclesCommand(cycleDetector, new ObjectMapper()));
    }

    private String captureOut(Runnable action) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        PrintStream old = System.out;
        System.setOut(new PrintStream(buf));
        try { action.run(); } finally { System.setOut(old); }
        return buf.toString();
    }

    private String captureErr(Runnable action) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        PrintStream old = System.err;
        System.setErr(new PrintStream(buf));
        try { action.run(); } finally { System.setErr(old); }
        return buf.toString();
    }

    // ── No cycles ─────────────────────────────────────────────────────────────

    @Test
    void run_noCycles_printsCleanMessage() {
        when(cycleDetector.findCycles("proj-a")).thenReturn(List.of());

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("No package cycles detected");
    }

    @Test
    void run_noCycles_noCountInStderr() {
        when(cycleDetector.findCycles("proj-a")).thenReturn(List.of());

        String err = captureErr(() -> cli.execute("proj-a"));

        assertThat(err).doesNotContain("cycle(s)");
    }

    // ── Text format ───────────────────────────────────────────────────────────

    @Test
    void run_oneCycle_printsSummaryToStderr() {
        when(cycleDetector.findCycles("proj-a"))
                .thenReturn(List.of(new PackageCycle(List.of("com.a", "com.b"))));

        String err = captureErr(() -> cli.execute("proj-a"));

        assertThat(err).contains("1").contains("proj-a");
    }

    @Test
    void run_oneCycle_printsCyclePackages() {
        when(cycleDetector.findCycles("proj-a"))
                .thenReturn(List.of(new PackageCycle(List.of("com.a", "com.b"))));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("com.a").contains("com.b").contains("Cycle #1");
    }

    @Test
    void run_multipleCycles_allPrinted() {
        when(cycleDetector.findCycles("proj-a"))
                .thenReturn(List.of(
                        new PackageCycle(List.of("com.x", "com.y", "com.z")),
                        new PackageCycle(List.of("com.p", "com.q"))));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("Cycle #1").contains("Cycle #2");
        assertThat(out).contains("com.x").contains("com.p");
    }

    @Test
    void run_tipPrintedToStderr() {
        when(cycleDetector.findCycles("proj-a"))
                .thenReturn(List.of(new PackageCycle(List.of("com.a", "com.b"))));

        String err = captureErr(() -> cli.execute("proj-a"));

        assertThat(err).containsIgnoringCase("Tip");
    }

    // ── JSON format ───────────────────────────────────────────────────────────

    @Test
    void run_jsonFlag_noCycles_printsEmptyArray() {
        when(cycleDetector.findCycles("proj-a")).thenReturn(List.of());

        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        assertThat(out.trim()).isEqualTo("[ ]");
    }

    @Test
    void run_jsonFlag_withCycles_printsJsonArray() {
        when(cycleDetector.findCycles("proj-a"))
                .thenReturn(List.of(new PackageCycle(List.of("com.a", "com.b"))));

        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        assertThat(out.trim()).startsWith("[").endsWith("]");
        assertThat(out).contains("packages").contains("com.a").contains("com.b");
    }
}
