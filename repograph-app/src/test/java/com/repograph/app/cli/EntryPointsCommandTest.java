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
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link EntryPointsCommand} 单元测试，验证入口点查询命令的参数传递和输出逻辑。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
class EntryPointsCommandTest {

    @Mock
    GraphQueryService graphQueryService;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new EntryPointsCommand(graphQueryService, new ObjectMapper()));
    }

    private static CodeUnit unit(String qn) {
        return new CodeUnit("id-" + qn, CodeUnitKind.METHOD, "java",
                qn, "get", "Ctrl.java", 1, 10, "", qn, List.of(), null,
                Map.of("is_entry_point", "true", "framework", "spring"));
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
    void run_noProjectFlag_passesNullToService() {
        when(graphQueryService.findEntryPoints(null)).thenReturn(List.of());

        cli.execute();

        verify(graphQueryService).findEntryPoints(null);
    }

    @Test
    void run_withProjectFlag_passesProjectIdToService() {
        when(graphQueryService.findEntryPoints("abc123def456")).thenReturn(List.of());

        cli.execute("--project", "abc123def456");

        verify(graphQueryService).findEntryPoints("abc123def456");
    }

    @Test
    void run_noEntryPoints_printsNoEntryPointsMessage() {
        when(graphQueryService.findEntryPoints(null)).thenReturn(List.of());

        String out = captureOut(() -> cli.execute());

        assertThat(out).contains("No entry points found");
    }

    @Test
    void run_withEntryPoints_printsJsonOutput() {
        when(graphQueryService.findEntryPoints(null))
                .thenReturn(List.of(unit("com.example.UserController#getUser")));

        String out = captureOut(() -> cli.execute());

        assertThat(out.trim()).startsWith("[");
        assertThat(out).contains("com.example.UserController#getUser");
    }
}
