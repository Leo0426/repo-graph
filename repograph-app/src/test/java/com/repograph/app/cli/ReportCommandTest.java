package com.repograph.app.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.metrics.ComplexityMetric;
import com.repograph.metrics.CouplingMetric;
import com.repograph.metrics.HealthReport;
import com.repograph.metrics.HealthReportService;
import com.repograph.metrics.PackageCycle;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@link ReportCommand} 单元测试，验证 Markdown 输出、JSON 格式和文件写入。
 *
 * @author leolu
 * @since 0.6.0
 */
@ExtendWith(MockitoExtension.class)
class ReportCommandTest {

    @Mock
    HealthReportService reportService;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new ReportCommand(reportService, new ObjectMapper()));
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

    private static HealthReport sampleReport(int score) {
        return new HealthReport(
                "proj-a", "/home/user/proj", "2024-01-01T00:00:00Z", score,
                100L, 20L, 250L,
                0L, 1L, 2L, 0L,
                1, 2, 3, 5L, 40L, 80L,
                List.of(new ComplexityMetric("com.Foo#bar", "Foo.java", 10, "METHOD", 15)),
                List.of(new CouplingMetric("com.Service", 1, 9, 0.9)),
                List.of(new PackageCycle(List.of("com.a", "com.b"))));
    }

    // ── Markdown output ───────────────────────────────────────────────────────

    @Test
    void run_markdownOutput_containsHealthScore() {
        when(reportService.generate("proj-a")).thenReturn(sampleReport(78));
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out)
                .contains("78")
                .contains("100")
                .contains("RepoGraph");
    }

    @Test
    void run_markdownOutput_containsProjectId() {
        when(reportService.generate("proj-a")).thenReturn(sampleReport(90));
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).contains("proj-a");
    }

    @Test
    void run_markdownOutput_containsTopComplexSection() {
        when(reportService.generate("proj-a")).thenReturn(sampleReport(85));
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).contains("com.Foo#bar").contains("15");
    }

    @Test
    void run_markdownOutput_containsCouplingSection() {
        when(reportService.generate("proj-a")).thenReturn(sampleReport(85));
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).contains("com.Service").contains("0.900");
    }

    @Test
    void run_markdownOutput_containsCyclesSection() {
        when(reportService.generate("proj-a")).thenReturn(sampleReport(70));
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).contains("com.a").contains("com.b");
    }

    // ── Grade ─────────────────────────────────────────────────────────────────

    @Test
    void run_score95_gradeA() {
        when(reportService.generate("proj-a")).thenReturn(sampleReport(95));
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).contains("A");
    }

    @Test
    void run_score60_gradeD() {
        when(reportService.generate("proj-a")).thenReturn(sampleReport(55));
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).contains("D");
    }

    // ── JSON output ───────────────────────────────────────────────────────────

    @Test
    void run_jsonFlag_outputIsValidJson() throws Exception {
        when(reportService.generate("proj-a")).thenReturn(sampleReport(82));
        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        // Must be parseable JSON object
        new ObjectMapper().readTree(out);
        assertThat(out).contains("healthScore").contains("projectId");
    }

    @Test
    void run_jsonFlag_containsAllTopLevelFields() throws Exception {
        when(reportService.generate("proj-a")).thenReturn(sampleReport(75));
        String out = captureOut(() -> cli.execute("proj-a", "--json"));
        assertThat(out)
                .contains("vulnHigh")
                .contains("topComplexMethods")
                .contains("packageCycleList");
    }

    // ── File output ───────────────────────────────────────────────────────────

    @Test
    void run_outFile_writesMarkdownToFile(@TempDir Path tmp) throws Exception {
        when(reportService.generate("proj-a")).thenReturn(sampleReport(88));
        Path outFile = tmp.resolve("report.md");

        cli.execute("proj-a", "--out", outFile.toString());

        assertThat(outFile).exists();
        String content = Files.readString(outFile);
        assertThat(content).contains("88").contains("RepoGraph").contains("proj-a");
    }

    @Test
    void run_outFile_printsConfirmationToStderr(@TempDir Path tmp) {
        when(reportService.generate("proj-a")).thenReturn(sampleReport(88));
        Path outFile = tmp.resolve("report.md");

        String err = captureErr(() -> cli.execute("proj-a", "--out", outFile.toString()));
        assertThat(err).containsIgnoringCase("report").containsIgnoringCase("written");
    }

    // ── toMarkdown static helper ──────────────────────────────────────────────

    @Test
    void toMarkdown_noCycles_showsCleanMessage() {
        HealthReport r = new HealthReport(
                "p", "/root", "2024-01-01T00:00:00Z", 100,
                10L, 2L, 30L,
                0L, 0L, 0L, 0L,
                0, 0, 0, 0L, 0L, 10L,
                List.of(), List.of(), List.of());
        assertThat(ReportCommand.toMarkdown(r)).contains("无循环依赖");
    }

    @Test
    void toMarkdown_noVulns_showsNoVulnMessage() {
        HealthReport r = new HealthReport(
                "p", "/root", "2024-01-01T00:00:00Z", 100,
                10L, 2L, 30L,
                0L, 0L, 0L, 0L,
                0, 0, 0, 0L, 0L, 10L,
                List.of(), List.of(), List.of());
        assertThat(ReportCommand.toMarkdown(r)).contains("无活跃漏洞");
    }

    @Test
    void toMarkdown_hasManyVulns_showsTable() {
        HealthReport r = new HealthReport(
                "p", "/root", "2024-01-01T00:00:00Z", 60,
                100L, 20L, 250L,
                0L, 3L, 5L, 2L,
                0, 0, 0, 0L, 0L, 100L,
                List.of(), List.of(), List.of());
        String md = ReportCommand.toMarkdown(r);
        assertThat(md).contains("HIGH").contains("MEDIUM").contains("LOW");
    }
}
