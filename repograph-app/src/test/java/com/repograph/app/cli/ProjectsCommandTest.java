package com.repograph.app.cli;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@link ProjectsCommand} 单元测试，验证项目列表命令的输出格式。
 *
 * @author leolu
 * @since 0.2.0
 */
@ExtendWith(MockitoExtension.class)
class ProjectsCommandTest {

    @Mock
    GraphQueryService graphQueryService;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new ProjectsCommand(graphQueryService));
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
    void run_noProjects_printsHelpfulMessage() {
        when(graphQueryService.listProjects()).thenReturn(List.of());

        String out = captureOut(() -> cli.execute());

        assertThat(out).contains("No indexed projects found");
    }

    @Test
    void run_listsProjectsInTableFormat() {
        when(graphQueryService.listProjects()).thenReturn(List.of(
                new ProjectInfo("abc123def456", "/Users/leo/projA", 1200L, "2026-06-11T10:00:00Z"),
                new ProjectInfo("7890fedcba98", "/Users/leo/projB", 450L,  "2026-06-10T15:30:00Z")
        ));

        String out = captureOut(() -> cli.execute());

        assertThat(out).contains("PROJECT_ID").contains("UNITS").contains("ROOT");
        assertThat(out).contains("abc123def456").contains("1200").contains("/Users/leo/projA");
        assertThat(out).contains("7890fedcba98").contains("450").contains("/Users/leo/projB");
    }

    @Test
    void run_emptyRoot_printsPlaceholder() {
        when(graphQueryService.listProjects()).thenReturn(List.of(
                new ProjectInfo("legacy123456", "", 50L, "")
        ));

        String out = captureOut(() -> cli.execute());

        assertThat(out).contains("(unknown)");
    }
}
