package com.repograph.app.cli;

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
 * {@link DeadCodeCommand} 单元测试，验证文本表格与 JSON 输出，以及无结果时的提示行为。
 *
 * @author leolu
 * @since 0.5.0
 */
@ExtendWith(MockitoExtension.class)
class DeadCodeCommandTest {

    @Mock
    GraphDiagnosticsService graphQueryService;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new DeadCodeCommand(graphQueryService));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static CodeUnit deadUnit(String qn, String file, int line) {
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

    // ── No results ────────────────────────────────────────────────────────────

    @Test
    void run_noDeadCode_printsNotFoundToStderr() {
        when(graphQueryService.findDeadCode("proj-a")).thenReturn(List.of());

        String err = captureErr(() -> cli.execute("proj-a"));

        assertThat(err).contains("No dead code found");
    }

    @Test
    void run_noDeadCode_noStdout() {
        when(graphQueryService.findDeadCode("proj-a")).thenReturn(List.of());

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).isEmpty();
    }

    // ── Text table format ────────────────────────────────────────────────────

    @Test
    void run_withResults_printsSummaryToStderr() {
        when(graphQueryService.findDeadCode("proj-a"))
                .thenReturn(List.of(deadUnit("com.example.Foo#unused", "Foo.java", 42)));

        String err = captureErr(() -> cli.execute("proj-a"));

        assertThat(err).contains("1").contains("proj-a");
    }

    @Test
    void run_withResults_printsQualifiedNameToStdout() {
        when(graphQueryService.findDeadCode("proj-a"))
                .thenReturn(List.of(deadUnit("com.example.Foo#unused", "Foo.java", 42)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("com.example.Foo#unused").contains("Foo.java").contains("42");
    }

    @Test
    void run_multipleResults_allPrinted() {
        when(graphQueryService.findDeadCode("proj-a"))
                .thenReturn(List.of(
                        deadUnit("com.example.Foo#a", "Foo.java", 10),
                        deadUnit("com.example.Bar#b", "Bar.java", 20)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("Foo#a").contains("Bar#b");
    }

    // ── JSON format ───────────────────────────────────────────────────────────

    @Test
    void run_jsonFlag_printsJsonArray() {
        when(graphQueryService.findDeadCode("proj-a"))
                .thenReturn(List.of(deadUnit("com.example.Foo#orphan", "Foo.java", 5)));

        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        assertThat(out.trim()).startsWith("[").endsWith("]");
        assertThat(out).contains("com.example.Foo#orphan").contains("qualifiedName");
    }

    @Test
    void run_jsonFlag_containsFileAndLine() {
        when(graphQueryService.findDeadCode("proj-a"))
                .thenReturn(List.of(deadUnit("com.example.Util#helper", "Util.java", 99)));

        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        assertThat(out).contains("\"filePath\"").contains("Util.java").contains("99");
    }

    @Test
    void run_jsonFlag_multipleItems_validStructure() {
        when(graphQueryService.findDeadCode("proj-a"))
                .thenReturn(List.of(
                        deadUnit("com.example.A#one", "A.java", 1),
                        deadUnit("com.example.B#two", "B.java", 2)));

        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        // Two JSON objects separated by comma — qualified names appear as substrings
        assertThat(out).contains(",");
        assertThat(out).contains("A#one").contains("B#two");
    }
}
