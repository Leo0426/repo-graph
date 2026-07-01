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
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link ImpactCommand} 单元测试，验证影响分析命令的参数传递和输出逻辑。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
class ImpactCommandTest {

    @Mock
    GraphQueryService graphQueryService;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new ImpactCommand(graphQueryService, new ObjectMapper()));
    }

    private static CodeUnit unit(String qn) {
        return new CodeUnit("id-" + qn, CodeUnitKind.METHOD, "java",
                qn, "method", "Foo.java", 1, 10, "", qn, List.of(), null, Map.of());
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
        when(graphQueryService.impactAnalysis("com.example.User")).thenReturn(Set.of());

        cli.execute("com.example.User");

        verify(graphQueryService).impactAnalysis("com.example.User");
    }

    @Test
    void run_noImpact_printsNoImpactMessage() {
        when(graphQueryService.impactAnalysis("com.example.Leaf")).thenReturn(Set.of());

        String out = captureOut(() -> cli.execute("com.example.Leaf"));

        assertThat(out).contains("No impact found");
    }

    @Test
    void run_withImpact_printsJsonOutput() {
        when(graphQueryService.impactAnalysis("com.example.User"))
                .thenReturn(Set.of(unit("com.example.UserService#save")));

        String out = captureOut(() -> cli.execute("com.example.User"));

        assertThat(out.trim()).startsWith("[");
        assertThat(out).contains("com.example.UserService#save");
    }

    @Test
    void run_returnsExitCodeZero() {
        when(graphQueryService.impactAnalysis("com.example.User")).thenReturn(Set.of());

        int exitCode = cli.execute("com.example.User");

        assertThat(exitCode).isEqualTo(0);
    }
}
