package com.repograph.app.cli;

import com.repograph.app.watcher.FileWatcherService;
import com.repograph.app.watcher.WatchedProject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link WatchCommand} 单元测试，验证 --list / --stop 标志和输出格式。
 *
 * <p>不测试 {@code repograph watch <path>}（会阻塞线程），仅验证 --list 和 --stop 路径。
 *
 * @author leolu
 * @since 0.4.0
 */
@ExtendWith(MockitoExtension.class)
class WatchCommandTest {

    @Mock FileWatcherService watcherService;

    @TempDir Path tempDir;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new WatchCommand(watcherService));
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

    // ── --list ────────────────────────────────────────────────────────────────

    @Test
    void list_noWatchedProjects_printsMessage() {
        when(watcherService.list()).thenReturn(List.of());

        String out = captureOut(() -> cli.execute("--list"));

        assertThat(out).contains("No projects currently being watched");
    }

    @Test
    void list_withProjects_printsTableWithIdAndRoot() {
        when(watcherService.list()).thenReturn(List.of(
                new WatchedProject("abc123def456", Path.of("/Users/leo/projA"), List.of()),
                new WatchedProject("bbb222ccc333", Path.of("/Users/leo/projB"), List.of())));

        String out = captureOut(() -> cli.execute("--list"));

        assertThat(out).contains("abc123def456").contains("/Users/leo/projA");
        assertThat(out).contains("bbb222ccc333").contains("/Users/leo/projB");
    }

    @Test
    void list_headerShown() {
        when(watcherService.list()).thenReturn(
                List.of(new WatchedProject("abc123def456", tempDir, List.of())));

        String out = captureOut(() -> cli.execute("--list"));

        assertThat(out).contains("PROJECT ID").contains("ROOT");
    }

    // ── --stop ────────────────────────────────────────────────────────────────

    @Test
    void stop_callsServiceAndPrintsConfirmation() {
        String out = captureOut(() -> cli.execute("--stop", "abc123def456"));

        verify(watcherService).stop("abc123def456");
        assertThat(out).contains("abc123def456");
    }

    // ── no args ───────────────────────────────────────────────────────────────

    @Test
    void noArgs_printsUsageToStderr() {
        String err = captureErr(() -> cli.execute());

        assertThat(err).contains("Usage");
    }
}
