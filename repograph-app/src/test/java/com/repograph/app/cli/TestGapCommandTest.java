package com.repograph.app.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@link TestGapCommand} 单元测试，验证测试空白文本表格与 JSON 输出，以及无结果时的提示。
 *
 * @author leolu
 * @since 0.6.0
 */
@ExtendWith(MockitoExtension.class)
class TestGapCommandTest {

    @Mock
    GraphDiagnosticsService graphQueryService;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new TestGapCommand(graphQueryService, new ObjectMapper()));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static CodeUnit unit(String qn, String file, int line) {
        return new CodeUnit("id-" + qn, CodeUnitKind.METHOD, "java",
                qn, qn.contains("#") ? qn.substring(qn.indexOf('#') + 1) : qn,
                file, line, line + 5, "", qn, List.of(), null, Map.of());
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

    // ── No gaps ───────────────────────────────────────────────────────────────

    @Test
    void run_noGaps_printsCoveredMessage() {
        when(graphQueryService.findTestGaps("proj-a")).thenReturn(List.of());

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("No test gaps found");
    }

    @Test
    void run_noGaps_noStdout_for_count() {
        when(graphQueryService.findTestGaps("proj-a")).thenReturn(List.of());

        String err = captureErr(() -> cli.execute("proj-a"));

        // No count line emitted when there's nothing to report
        assertThat(err).doesNotContain("method(s)");
    }

    // ── Text table format ────────────────────────────────────────────────────

    @Test
    void run_withGaps_printsSummaryToStderr() {
        when(graphQueryService.findTestGaps("proj-a"))
                .thenReturn(List.of(
                        unit("com.example.Service#doWork", "Service.java", 42),
                        unit("com.example.Repo#query", "Repo.java", 10)));

        String err = captureErr(() -> cli.execute("proj-a"));

        assertThat(err).contains("2").contains("proj-a");
    }

    @Test
    void run_withGaps_printsTableHeader() {
        when(graphQueryService.findTestGaps("proj-a"))
                .thenReturn(List.of(unit("com.example.Foo#bar", "Foo.java", 1)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("KIND").contains("QUALIFIED NAME").contains("LOCATION");
    }

    @Test
    void run_withGaps_printsMethodRow() {
        when(graphQueryService.findTestGaps("proj-a"))
                .thenReturn(List.of(unit("com.example.OrderService#process", "OrderService.java", 55)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("com.example.OrderService#process")
                       .contains("OrderService.java")
                       .contains("55");
    }

    @Test
    void run_multipleGaps_allPrinted() {
        when(graphQueryService.findTestGaps("proj-a"))
                .thenReturn(List.of(
                        unit("com.example.A#one", "A.java", 10),
                        unit("com.example.B#two", "B.java", 20),
                        unit("com.example.C#three", "C.java", 30)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("A#one").contains("B#two").contains("C#three");
    }

    // ── JSON format ───────────────────────────────────────────────────────────

    @Test
    void run_jsonFlag_printsJsonArray() {
        when(graphQueryService.findTestGaps("proj-a"))
                .thenReturn(List.of(unit("com.example.Foo#uncovered", "Foo.java", 5)));

        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        assertThat(out.trim()).startsWith("[").endsWith("]");
        assertThat(out).contains("qualifiedName").contains("com.example.Foo#uncovered");
    }

    @Test
    void run_jsonFlag_containsFileAndLine() {
        when(graphQueryService.findTestGaps("proj-a"))
                .thenReturn(List.of(unit("com.example.Util#helper", "Util.java", 99)));

        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        assertThat(out).contains("filePath").contains("Util.java").contains("99");
    }

    @Test
    void run_jsonFlag_containsKind() {
        when(graphQueryService.findTestGaps("proj-a"))
                .thenReturn(List.of(unit("com.example.A#m", "A.java", 1)));

        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        assertThat(out).contains("\"kind\"").contains("METHOD");
    }
}
