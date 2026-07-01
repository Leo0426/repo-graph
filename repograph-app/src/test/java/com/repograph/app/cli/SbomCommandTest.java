package com.repograph.app.cli;

import com.repograph.sbom.SbomException;
import com.repograph.sbom.SbomService;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * {@link SbomCommand} 单元测试，验证 SBOM 生成命令的输出和错误处理。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
class SbomCommandTest {

    @TempDir
    Path tempDir;

    @Mock
    SbomService sbomService;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new SbomCommand(sbomService));
    }

    private String captureOut(Runnable action) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        PrintStream old = System.out;
        System.setOut(new PrintStream(buf));
        try {
            action.run();
        } finally {
            System.setOut(old);
        }
        return buf.toString();
    }

    private String captureErr(Runnable action) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        PrintStream old = System.err;
        System.setErr(new PrintStream(buf));
        try {
            action.run();
        } finally {
            System.setErr(old);
        }
        return buf.toString();
    }

    @Test
    void run_success_printsSbomJson() {
        String json = "{\"bomFormat\":\"CycloneDX\"}";
        when(sbomService.generateCycloneDx(any(Path.class))).thenReturn(json);

        String out = captureOut(() -> cli.execute(tempDir.toString()));

        assertThat(out.trim()).isEqualTo(json);
    }

    @Test
    void run_sbomException_printsErrorToStderr() {
        when(sbomService.generateCycloneDx(any(Path.class)))
                .thenThrow(new SbomException("pom.xml not found"));

        String err = captureErr(() -> cli.execute(tempDir.toString()));

        assertThat(err).contains("SBOM generation failed").contains("pom.xml not found");
    }

    @Test
    void run_sbomException_returnsExitCodeZero() {
        when(sbomService.generateCycloneDx(any(Path.class)))
                .thenThrow(new SbomException("pom.xml not found"));

        int exitCode = cli.execute(tempDir.toString());

        assertThat(exitCode).isEqualTo(0);
    }
}
