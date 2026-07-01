package com.repograph.app.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.metrics.ComplexityAnalyzer;
import com.repograph.metrics.ComplexityMetric;
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
 * {@link ComplexityCommand} 单元测试，验证文本表格和 JSON 两种输出格式。
 *
 * @author leolu
 * @since 0.6.0
 */
@ExtendWith(MockitoExtension.class)
class ComplexityCommandTest {

    @Mock
    ComplexityAnalyzer complexityAnalyzer;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new ComplexityCommand(complexityAnalyzer, new ObjectMapper()));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static ComplexityMetric metric(String qn, String file, int line, int cc) {
        return new ComplexityMetric(qn, file, line, "METHOD", cc);
    }

    private String captureOut(Runnable action) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        PrintStream old = System.out;
        System.setOut(new PrintStream(buf));
        try { action.run(); } finally { System.setOut(old); }
        return buf.toString();
    }

    // ── Text table format ────────────────────────────────────────────────────

    @Test
    void run_tableFormat_printsHeader() {
        when(complexityAnalyzer.topComplex("proj-a", 20))
                .thenReturn(List.of(metric("com.example.Foo#doWork", "Foo.java", 10, 12)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("CC").contains("Kind").contains("Method").contains("File:Line");
    }

    @Test
    void run_tableFormat_printsMethodRow() {
        when(complexityAnalyzer.topComplex("proj-a", 20))
                .thenReturn(List.of(metric("com.example.Foo#doWork", "Foo.java", 10, 12)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("12").contains("com.example.Foo#doWork").contains("Foo.java:10");
    }

    @Test
    void run_highComplexity_showsHighRiskMarker() {
        when(complexityAnalyzer.topComplex("proj-a", 20))
                .thenReturn(List.of(metric("com.example.Monster#doEverything", "Monster.java", 1, 15)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("[HIGH]");
    }

    @Test
    void run_mediumComplexity_showsMedRiskMarker() {
        when(complexityAnalyzer.topComplex("proj-a", 20))
                .thenReturn(List.of(metric("com.example.Foo#moderate", "Foo.java", 5, 8)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("[MED]");
    }

    @Test
    void run_lowComplexity_noRiskMarker() {
        when(complexityAnalyzer.topComplex("proj-a", 20))
                .thenReturn(List.of(metric("com.example.Foo#simple", "Foo.java", 2, 3)));

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).doesNotContain("[HIGH]").doesNotContain("[MED]");
    }

    @Test
    void run_noData_printsNotFoundMessage() {
        when(complexityAnalyzer.topComplex("proj-a", 20)).thenReturn(List.of());

        String out = captureOut(() -> cli.execute("proj-a"));

        assertThat(out).contains("No methods found");
    }

    // ── JSON format ───────────────────────────────────────────────────────────

    @Test
    void run_jsonFlag_printsJsonArray() {
        when(complexityAnalyzer.topComplex("proj-a", 20))
                .thenReturn(List.of(
                        metric("com.example.Foo#doWork", "Foo.java", 10, 12),
                        metric("com.example.Bar#parse", "Bar.java", 20, 7)));

        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        assertThat(out.trim()).startsWith("[");
        assertThat(out).contains("doWork").contains("parse");
    }

    @Test
    void run_jsonFlag_containsComplexityField() {
        when(complexityAnalyzer.topComplex("proj-a", 20))
                .thenReturn(List.of(metric("com.example.Foo#check", "Foo.java", 5, 9)));

        String out = captureOut(() -> cli.execute("proj-a", "--json"));

        assertThat(out).contains("\"complexity\"").contains("9");
    }

    // ── Limit handling ────────────────────────────────────────────────────────

    @Test
    void run_customLimit_passedToAnalyzer() {
        when(complexityAnalyzer.topComplex("proj-a", 5)).thenReturn(List.of());

        cli.execute("proj-a", "--limit", "5");

        verify(complexityAnalyzer).topComplex("proj-a", 5);
    }

    @Test
    void run_limitOver100_cappedAt100() {
        when(complexityAnalyzer.topComplex("proj-a", 100)).thenReturn(List.of());

        cli.execute("proj-a", "--limit", "9999");

        verify(complexityAnalyzer).topComplex("proj-a", 100);
    }
}
