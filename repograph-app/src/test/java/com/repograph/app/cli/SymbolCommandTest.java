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
import static org.mockito.Mockito.when;

/**
 * {@link SymbolCommand} 单元测试，验证按全限定名查找符号的命令输出。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
class SymbolCommandTest {

    @Mock
    VectorStore vectorStore;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new SymbolCommand(vectorStore, new ObjectMapper()));
    }

    private static CodeUnit unit(String qn) {
        return new CodeUnit("id", CodeUnitKind.CLASS, "java",
                qn, "Foo", "Foo.java", 1, 20, "", qn, List.of(), null, Map.of());
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
        when(vectorStore.symbolLookup("com.example.Foo"))
                .thenReturn(Optional.of(unit("com.example.Foo")));

        String out = captureOut(() -> cli.execute("com.example.Foo"));

        assertThat(out).contains("com.example.Foo");
        assertThat(out.trim()).startsWith("{");
    }

    @Test
    void run_notFound_printsNothingToStdout() {
        when(vectorStore.symbolLookup("com.example.Missing")).thenReturn(Optional.empty());

        String out = captureOut(() -> cli.execute("com.example.Missing"));

        assertThat(out).isEmpty();
    }

    @Test
    void run_notFound_returnsExitCodeZero() {
        when(vectorStore.symbolLookup("com.example.Missing")).thenReturn(Optional.empty());

        int exitCode = cli.execute("com.example.Missing");

        assertThat(exitCode).isEqualTo(0);
    }

    @Test
    void run_found_outputContainsKindAndLanguageFields() {
        when(vectorStore.symbolLookup("com.example.Foo"))
                .thenReturn(Optional.of(unit("com.example.Foo")));

        String out = captureOut(() -> cli.execute("com.example.Foo"));

        assertThat(out).contains("\"kind\"").contains("\"language\"");
    }

    @Test
    void run_found_outputIsJsonObject() throws Exception {
        when(vectorStore.symbolLookup("com.example.Foo"))
                .thenReturn(Optional.of(unit("com.example.Foo")));

        String out = captureOut(() -> cli.execute("com.example.Foo"));

        new ObjectMapper().readTree(out.trim()); // throws if not valid JSON
        assertThat(out.trim()).startsWith("{").endsWith("}");
    }
}
