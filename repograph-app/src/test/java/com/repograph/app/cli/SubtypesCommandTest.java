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
 * {@link SubtypesCommand} 单元测试，验证子类型查询命令的参数传递和输出逻辑。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
class SubtypesCommandTest {

    @Mock
    GraphQueryService graphQueryService;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new SubtypesCommand(graphQueryService, new ObjectMapper()));
    }

    private static CodeUnit unit(String qn) {
        return new CodeUnit("id-" + qn, CodeUnitKind.CLASS, "java",
                qn, "Impl", "Impl.java", 1, 20, "", qn, List.of(), null, Map.of());
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
    void run_passesQualifiedNameToService() {
        when(graphQueryService.findSubTypes("com.example.IService")).thenReturn(List.of());

        cli.execute("com.example.IService");

        verify(graphQueryService).findSubTypes("com.example.IService");
    }

    @Test
    void run_noSubtypes_printsNoSubtypesMessage() {
        when(graphQueryService.findSubTypes("com.example.LeafClass")).thenReturn(List.of());

        String out = captureOut(() -> cli.execute("com.example.LeafClass"));

        assertThat(out).contains("No subtypes found");
    }

    @Test
    void run_withSubtypes_printsJsonOutput() {
        when(graphQueryService.findSubTypes("com.example.IService"))
                .thenReturn(List.of(unit("com.example.ServiceImpl")));

        String out = captureOut(() -> cli.execute("com.example.IService"));

        assertThat(out.trim()).startsWith("[");
        assertThat(out).contains("com.example.ServiceImpl");
    }

    @Test
    void run_returnsExitCodeZero() {
        when(graphQueryService.findSubTypes("com.example.IService")).thenReturn(List.of());

        int exitCode = cli.execute("com.example.IService");

        assertThat(exitCode).isEqualTo(0);
    }
}
