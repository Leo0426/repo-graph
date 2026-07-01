package com.repograph.app.cli;

import com.repograph.core.pipeline.IndexOptions;
import com.repograph.core.pipeline.IndexPipeline;
import com.repograph.core.pipeline.IndexResult;
import com.repograph.core.parser.ParseStrategy;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import picocli.CommandLine;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link IndexCommand} 单元测试，验证索引命令的选项解析和管道调用逻辑。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
class IndexCommandTest {

    @TempDir
    Path projectRoot;

    @Mock
    IndexPipeline indexPipeline;

    private CommandLine cli;

    @BeforeEach
    void setUp() {
        cli = new CommandLine(new IndexCommand(indexPipeline));
        when(indexPipeline.index(any(), any()))
                .thenReturn(new IndexResult(5, 5, 0, 0, 42, 10, 300L, List.of()));
    }

    @Test
    void run_defaultOptions_usesAutoStrategy() {
        cli.execute(projectRoot.toString());

        ArgumentCaptor<IndexOptions> captor = ArgumentCaptor.forClass(IndexOptions.class);
        verify(indexPipeline).index(any(), captor.capture());

        assertThat(captor.getValue().strategy()).isEqualTo(ParseStrategy.AUTO);
        assertThat(captor.getValue().incremental()).isTrue();
    }

    @Test
    void run_noIncrementalFlag_disablesIncremental() {
        cli.execute(projectRoot.toString(), "--no-incremental");

        ArgumentCaptor<IndexOptions> captor = ArgumentCaptor.forClass(IndexOptions.class);
        verify(indexPipeline).index(any(), captor.capture());

        assertThat(captor.getValue().incremental()).isFalse();
    }

    @Test
    void run_langOption_passesLanguageList() {
        cli.execute(projectRoot.toString(), "--lang", "java,c");

        ArgumentCaptor<IndexOptions> captor = ArgumentCaptor.forClass(IndexOptions.class);
        verify(indexPipeline).index(any(), captor.capture());

        assertThat(captor.getValue().languages()).containsExactly("java", "c");
    }

    @Test
    void run_strategyOption_parsesPrecise() {
        cli.execute(projectRoot.toString(), "--strategy", "precise");

        ArgumentCaptor<IndexOptions> captor = ArgumentCaptor.forClass(IndexOptions.class);
        verify(indexPipeline).index(any(), captor.capture());

        assertThat(captor.getValue().strategy()).isEqualTo(ParseStrategy.PRECISE);
    }

    @Test
    void run_withErrors_returnsZeroExitCode() {
        when(indexPipeline.index(any(), any()))
                .thenReturn(new IndexResult(1, 1, 0, 0, 0, 0, 50L, List.of("parse error")));

        int exitCode = cli.execute(projectRoot.toString());

        assertThat(exitCode).isEqualTo(0);
    }
}
