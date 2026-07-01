package com.repograph.app.cli;

import com.repograph.core.pipeline.IndexStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * {@link DeleteCommand} 单元测试，验证项目删除命令的确认门和委托逻辑。
 *
 * @author leolu
 * @since 0.2.0
 */
@ExtendWith(MockitoExtension.class)
class DeleteCommandTest {

    @Mock
    IndexStore indexStore;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new DeleteCommand(indexStore));
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
    void run_withoutYes_doesNotDeleteAndPromptsForConfirm() {
        String err = captureErr(() -> cli.execute("abc123"));

        assertThat(err).contains("About to delete").contains("Re-run with --yes");
        verify(indexStore, never()).removeProject(any());
    }

    @Test
    void run_withYes_invokesRemove() {
        cli.execute("abc123", "--yes");

        verify(indexStore).removeProject("abc123");
    }

    @Test
    void run_withShortFlag_y_invokesRemove() {
        cli.execute("abc123", "-y");

        verify(indexStore).removeProject("abc123");
    }

    private static String any() { return org.mockito.ArgumentMatchers.anyString(); }
}
