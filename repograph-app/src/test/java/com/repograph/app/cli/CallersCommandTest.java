package com.repograph.app.cli;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link CallersCommand} 单元测试，验证调用方查询命令的参数解析和输出逻辑。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
class CallersCommandTest {

    @Mock
    GraphQueryService graphQueryService;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new CallersCommand(graphQueryService, new ObjectMapper()));
    }

    private static CodeUnit unit(String qn) {
        return new CodeUnit("id", CodeUnitKind.METHOD, "java",
                qn, "bar", "Foo.java", 1, 10, "", qn, List.of(), null, Map.of());
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
    void run_defaultDepth_usesDepthThree() {
        when(graphQueryService.findCallers("com.example.Foo#bar", 3)).thenReturn(List.of());

        cli.execute("com.example.Foo#bar");

        verify(graphQueryService).findCallers("com.example.Foo#bar", 3);
    }

    @Test
    void run_customDepth_passedToService() {
        when(graphQueryService.findCallers("com.example.Foo#bar", 1)).thenReturn(List.of());

        cli.execute("com.example.Foo#bar", "--depth", "1");

        verify(graphQueryService).findCallers("com.example.Foo#bar", 1);
    }

    @Test
    void run_noCallers_printsNoCallersMessage() {
        when(graphQueryService.findCallers(eq("com.example.Foo#bar"), eq(3)))
                .thenReturn(List.of());

        String out = captureOut(() -> cli.execute("com.example.Foo#bar"));

        assertThat(out).contains("No callers");
    }

    @Test
    void run_withCallers_printsJsonOutput() {
        when(graphQueryService.findCallers(eq("com.example.Foo#bar"), eq(3)))
                .thenReturn(List.of(unit("com.example.Caller#test")));

        String out = captureOut(() -> cli.execute("com.example.Foo#bar"));

        assertThat(out.trim()).startsWith("[");
        assertThat(out).contains("com.example.Caller#test");
    }
}
