package com.repograph.app.cli;

import com.repograph.export.GraphExportService;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@link ExportCommand} 单元测试，验证 DOT/Mermaid 输出和文件写入。
 *
 * @author leolu
 * @since 0.7.0
 */
@ExtendWith(MockitoExtension.class)
class ExportCommandTest {

    @Mock GraphExportService graphExportService;

    private CommandLine cli;

    private static final String SAMPLE_DOT = "digraph RepoGraph {\n    rankdir=LR;\n}\n";
    private static final String SAMPLE_MERMAID = "graph LR\n    com_a[\"a\"]\n    com_a --> com_b\n";

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new ExportCommand(graphExportService));
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

    // ── Default format (Mermaid) ──────────────────────────────────────────────

    @Test
    void run_defaultFormat_outputsMermaid() {
        when(graphExportService.exportMermaid("proj-a")).thenReturn(SAMPLE_MERMAID);
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).contains("graph LR");
    }

    @Test
    void run_defaultFormat_noFileArg_writesToStdout() {
        when(graphExportService.exportMermaid("proj-a")).thenReturn(SAMPLE_MERMAID);
        String out = captureOut(() -> cli.execute("proj-a"));
        assertThat(out).isNotEmpty();
    }

    // ── DOT format ────────────────────────────────────────────────────────────

    @Test
    void run_dotFormat_outputsDot() {
        when(graphExportService.exportDot("proj-a")).thenReturn(SAMPLE_DOT);
        String out = captureOut(() -> cli.execute("proj-a", "--format", "dot"));
        assertThat(out).contains("digraph");
    }

    @Test
    void run_dotFormatShortFlag_works() {
        when(graphExportService.exportDot("proj-a")).thenReturn(SAMPLE_DOT);
        String out = captureOut(() -> cli.execute("proj-a", "-f", "dot"));
        assertThat(out).contains("digraph");
    }

    // ── Mermaid format ────────────────────────────────────────────────────────

    @Test
    void run_mermaidFormat_outputsMermaid() {
        when(graphExportService.exportMermaid("proj-a")).thenReturn(SAMPLE_MERMAID);
        String out = captureOut(() -> cli.execute("proj-a", "--format", "mermaid"));
        assertThat(out).contains("graph LR");
    }

    // ── File output ───────────────────────────────────────────────────────────

    @Test
    void run_outFileDot_writesFileContent(@TempDir Path tmp) throws Exception {
        when(graphExportService.exportDot("proj-a")).thenReturn(SAMPLE_DOT);
        Path file = tmp.resolve("deps.dot");

        cli.execute("proj-a", "--format", "dot", "--out", file.toString());

        assertThat(file).exists();
        assertThat(Files.readString(file)).contains("digraph");
    }

    @Test
    void run_outFileMermaid_writesFileContent(@TempDir Path tmp) throws Exception {
        when(graphExportService.exportMermaid("proj-a")).thenReturn(SAMPLE_MERMAID);
        Path file = tmp.resolve("deps.mmd");

        cli.execute("proj-a", "-f", "mermaid", "-o", file.toString());

        assertThat(file).exists();
        assertThat(Files.readString(file)).contains("graph LR");
    }

    @Test
    void run_outFile_nothingWrittenToStdout(@TempDir Path tmp) {
        when(graphExportService.exportMermaid("proj-a")).thenReturn(SAMPLE_MERMAID);
        Path file = tmp.resolve("out.mmd");
        String out = captureOut(() -> cli.execute("proj-a", "--out", file.toString()));
        assertThat(out).isEmpty();
    }

    @Test
    void run_outFile_confirmationPrintedToStderr(@TempDir Path tmp) {
        when(graphExportService.exportMermaid("proj-a")).thenReturn(SAMPLE_MERMAID);
        Path file = tmp.resolve("out.mmd");
        String err = captureErr(() -> cli.execute("proj-a", "--out", file.toString()));
        assertThat(err).containsIgnoringCase("written");
    }
}
