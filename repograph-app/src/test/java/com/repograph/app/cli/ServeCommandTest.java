package com.repograph.app.cli;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import picocli.CommandLine;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link ServeCommand} 单元测试，验证 serve 子命令的参数解析和正常退出。
 *
 * @author leolu
 * @since 0.1.0
 */
class ServeCommandTest {

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new ServeCommand());
    }

    @Test
    void run_noArgs_returnsExitCodeZero() {
        int exitCode = cli.execute();
        assertThat(exitCode).isEqualTo(0);
    }

    @Test
    void run_customPort_returnsExitCodeZero() {
        int exitCode = cli.execute("--port", "9090");
        assertThat(exitCode).isEqualTo(0);
    }

    @Test
    void run_helpFlag_returnsExitCodeZero() {
        int exitCode = cli.execute("--help");
        assertThat(exitCode).isEqualTo(0);
    }
}
