package com.repograph.app.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.metrics.GitChurnAnalyzer;
import com.repograph.metrics.HotspotMetric;
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
 * {@link HotspotsCommand} 单元测试，验证文本输出和 JSON 两种格式。
 *
 * @author leolu
 * @since 0.7.0
 */
@ExtendWith(MockitoExtension.class)
class HotspotsCommandTest {

    @Mock GitChurnAnalyzer gitChurnAnalyzer;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new HotspotsCommand(gitChurnAnalyzer, new ObjectMapper()));
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

    private static HotspotMetric hotspot(String file, int churn, double avgCC, double score) {
        return new HotspotMetric(file, churn, 3, avgCC, score);
    }

    // ── No data ───────────────────────────────────────────────────────────────

    @Test
    void run_noHotspots_printsHelpMessage() {
        when(gitChurnAnalyzer.topHotspots("proj-a", 10)).thenReturn(List.of());
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).containsIgnoringCase("No hotspot");
    }

    @Test
    void run_noHotspots_noTableHeader() {
        when(gitChurnAnalyzer.topHotspots("proj-a", 10)).thenReturn(List.of());
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).doesNotContain("Score");
    }

    // ── Text output ───────────────────────────────────────────────────────────

    @Test
    void run_oneHotspot_printsFileNameAndScore() {
        when(gitChurnAnalyzer.topHotspots("proj-a", 10))
                .thenReturn(List.of(hotspot("src/main/java/Foo.java", 25, 12.0, 38.5)));
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).contains("Foo.java").contains("38.5");
    }

    @Test
    void run_multipleHotspots_allPrinted() {
        when(gitChurnAnalyzer.topHotspots("proj-a", 10))
                .thenReturn(List.of(
                        hotspot("src/A.java", 100, 8.0, 45.0),
                        hotspot("src/B.java", 20, 15.0, 43.0)));
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).contains("A.java").contains("B.java");
    }

    @Test
    void run_summaryPrintedToStderr() {
        when(gitChurnAnalyzer.topHotspots("proj-a", 10))
                .thenReturn(List.of(hotspot("Foo.java", 5, 6.0, 10.7)));
        String err = captureErr(() -> cli.execute("proj-a"));
        assertThat(err).contains("proj-a");
    }

    @Test
    void run_tipPrintedToStderr() {
        when(gitChurnAnalyzer.topHotspots("proj-a", 10))
                .thenReturn(List.of(hotspot("Foo.java", 5, 6.0, 10.7)));
        String err = captureErr(() -> cli.execute("proj-a"));
        assertThat(err).containsIgnoringCase("Tip");
    }

    @Test
    void run_highScoreMarkedWithExclamation() {
        // Score >= 20 → !!!
        when(gitChurnAnalyzer.topHotspots("proj-a", 10))
                .thenReturn(List.of(hotspot("Hot.java", 50, 15.0, 25.0)));
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).contains("!!!");
    }

    @Test
    void run_customLimit_passedToAnalyzer() {
        when(gitChurnAnalyzer.topHotspots("proj-a", 5))
                .thenReturn(List.of(hotspot("F.java", 10, 7.0, 13.0)));
        String out = captureOut(() -> cli.execute("proj-a", "--limit", "5"));
        assertThat(out).contains("F.java");
    }

    // ── JSON output ───────────────────────────────────────────────────────────

    @Test
    void run_jsonFlag_emptyList_printsEmptyArray() {
        when(gitChurnAnalyzer.topHotspots("proj-a", 10)).thenReturn(List.of());
        String out = captureOut(() -> cli.execute("proj-a", "--json"));
        assertThat(out.trim()).isEqualTo("[ ]");
    }

    @Test
    void run_jsonFlag_withData_validJson() throws Exception {
        when(gitChurnAnalyzer.topHotspots("proj-a", 10))
                .thenReturn(List.of(hotspot("src/Foo.java", 8, 10.0, 22.2)));
        String out = captureOut(() -> cli.execute("proj-a", "--json"));
        new ObjectMapper().readTree(out);
        assertThat(out).contains("filePath").contains("churnCount").contains("hotspotScore");
    }

    @Test
    void run_jsonFlag_containsAllFields() {
        when(gitChurnAnalyzer.topHotspots("proj-a", 10))
                .thenReturn(List.of(hotspot("Foo.java", 12, 9.0, 24.8)));
        String out = captureOut(() -> cli.execute("proj-a", "--json"));
        assertThat(out)
                .contains("filePath")
                .contains("churnCount")
                .contains("methodCount")
                .contains("avgComplexity")
                .contains("hotspotScore");
    }
}
