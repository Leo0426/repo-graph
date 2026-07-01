package com.repograph.app.cli;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.vector.VectorStore;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link LocateCommand} 单元测试，验证按文件路径和行号定位符号命令的行为。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
class LocateCommandTest {

    @Mock
    VectorStore vectorStore;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new LocateCommand(vectorStore, new ObjectMapper()));
    }

    private static CodeUnit unit() {
        return new CodeUnit("id", CodeUnitKind.METHOD, "java",
                "com.example.Foo#bar", "bar", "src/Foo.java",
                5, 15, "", "void bar()", List.of(), "com.example.Foo", Map.of());
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

    @Test
    void run_found_printsJsonUnit() {
        when(vectorStore.locateByPosition("src/Foo.java", 10)).thenReturn(Optional.of(unit()));

        String out = captureOut(() -> cli.execute("--file", "src/Foo.java", "--line", "10"));

        assertThat(out.trim()).startsWith("{");
        assertThat(out).contains("com.example.Foo#bar");
    }

    @Test
    void run_notFound_printsNothingToStdout() {
        when(vectorStore.locateByPosition("src/Foo.java", 999)).thenReturn(Optional.empty());

        String out = captureOut(() -> cli.execute("--file", "src/Foo.java", "--line", "999"));

        assertThat(out).isEmpty();
    }

    @Test
    void run_callsLocateByPositionWithCorrectArgs() {
        when(vectorStore.locateByPosition("src/Bar.java", 42)).thenReturn(Optional.empty());

        cli.execute("--file", "src/Bar.java", "--line", "42");

        verify(vectorStore).locateByPosition("src/Bar.java", 42);
    }

    @Test
    void run_returnsExitCodeZero() {
        when(vectorStore.locateByPosition("src/Foo.java", 1)).thenReturn(Optional.empty());

        int exitCode = cli.execute("--file", "src/Foo.java", "--line", "1");

        assertThat(exitCode).isEqualTo(0);
    }
}
