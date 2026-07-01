package com.repograph.app.cli;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.vector.SearchPage;
import com.repograph.core.vector.SearchResult;
import com.repograph.core.vector.VectorStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.mockito.ArgumentCaptor;
import com.repograph.core.vector.SearchOptions;

/**
 * {@link SearchCommand} 单元测试，验证语义和代码相似检索命令的输出逻辑。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SearchCommandTest {

    @Mock
    VectorStore vectorStore;

    private SearchCommand command;
    private CommandLine cli;

    @BeforeEach
    void setUp() {
        command = new SearchCommand(vectorStore, new ObjectMapper());
        cli = new CommandLine(command);
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
    void run_semanticMode_callsSemanticSearch() {
        when(vectorStore.semanticSearch(eq("find services"), any()))
                .thenReturn(new SearchPage(List.of(new SearchResult(unit("com.example.Foo#bar"), 0.9f)), 0, 10, false));

        cli.execute("find services");

        verify(vectorStore).semanticSearch(eq("find services"), any());
    }

    @Test
    void run_codeMode_callsCodeSearch() {
        when(vectorStore.codeSearch(eq("void foo()"), any())).thenReturn(new SearchPage(List.of(), 0, 10, false));

        cli.execute("void foo()", "--mode", "code");

        verify(vectorStore).codeSearch(eq("void foo()"), any());
    }

    @Test
    void run_tableFormat_printsTable() {
        when(vectorStore.semanticSearch(any(), any()))
                .thenReturn(new SearchPage(List.of(new SearchResult(unit("com.example.Foo#bar"), 0.85f)), 0, 10, false));

        String out = captureOut(() -> cli.execute("test query"));

        assertThat(out).contains("SCORE").contains("KIND").contains("com.example.Foo#bar");
    }

    @Test
    void run_jsonFormat_printsValidJson() {
        when(vectorStore.semanticSearch(any(), any()))
                .thenReturn(new SearchPage(List.of(new SearchResult(unit("com.example.Foo#bar"), 0.75f)), 0, 10, false));

        String out = captureOut(() -> cli.execute("test query", "--format", "json"));

        assertThat(out.trim()).startsWith("[");
        assertThat(out).contains("com.example.Foo#bar");
    }

    @Test
    void run_noResults_printsNoResultsMessage() {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(new SearchPage(List.of(), 0, 10, false));

        String out = captureOut(() -> cli.execute("nothing"));

        assertThat(out).contains("No results");
    }

    @Test
    void run_invalidKind_ignoresFilter() {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(new SearchPage(List.of(), 0, 10, false));

        int exitCode = cli.execute("query", "--kind", "INVALID");

        assertThat(exitCode).isEqualTo(0);
    }

    // ── SearchOptions mapping tests ────────────────────────────────────────────

    @Test
    void run_withLangOption_passesLanguageInOptions() {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(new SearchPage(List.of(), 0, 10, false));
        ArgumentCaptor<SearchOptions> captor = ArgumentCaptor.forClass(SearchOptions.class);

        cli.execute("query", "--lang", "java");

        verify(vectorStore).semanticSearch(any(), captor.capture());
        assertThat(captor.getValue().language()).isEqualTo("java");
    }

    @Test
    void run_withEntryOnly_passesEntryOnlyTrue() {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(new SearchPage(List.of(), 0, 10, false));
        ArgumentCaptor<SearchOptions> captor = ArgumentCaptor.forClass(SearchOptions.class);

        cli.execute("query", "--entry-only");

        verify(vectorStore).semanticSearch(any(), captor.capture());
        assertThat(captor.getValue().entryOnly()).isTrue();
    }

    @Test
    void run_withNoTest_passesNoTestTrue() {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(new SearchPage(List.of(), 0, 10, false));
        ArgumentCaptor<SearchOptions> captor = ArgumentCaptor.forClass(SearchOptions.class);

        cli.execute("query", "--no-test");

        verify(vectorStore).semanticSearch(any(), captor.capture());
        assertThat(captor.getValue().noTest()).isTrue();
    }

    @Test
    void run_withLimit_passesLimitInOptions() {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(new SearchPage(List.of(), 0, 10, false));
        ArgumentCaptor<SearchOptions> captor = ArgumentCaptor.forClass(SearchOptions.class);

        cli.execute("query", "--limit", "5");

        verify(vectorStore).semanticSearch(any(), captor.capture());
        assertThat(captor.getValue().limit()).isEqualTo(5);
    }

    @Test
    void run_withProjectOption_passesProjectIdInOptions() {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(new SearchPage(List.of(), 0, 10, false));
        ArgumentCaptor<SearchOptions> captor = ArgumentCaptor.forClass(SearchOptions.class);

        cli.execute("query", "--project", "proj-abc123");

        verify(vectorStore).semanticSearch(any(), captor.capture());
        assertThat(captor.getValue().projectId()).isEqualTo("proj-abc123");
    }

    @Test
    void run_withKindMethod_parsesKindFromString() {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(new SearchPage(List.of(), 0, 10, false));
        ArgumentCaptor<SearchOptions> captor = ArgumentCaptor.forClass(SearchOptions.class);

        cli.execute("query", "--kind", "METHOD");

        verify(vectorStore).semanticSearch(any(), captor.capture());
        assertThat(captor.getValue().kind()).isEqualTo(CodeUnitKind.METHOD);
    }

    @Test
    void run_withOffset_passesOffsetInOptions() {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(new SearchPage(List.of(), 10, 10, false));
        ArgumentCaptor<SearchOptions> captor = ArgumentCaptor.forClass(SearchOptions.class);

        cli.execute("query", "--offset", "10");

        verify(vectorStore).semanticSearch(any(), captor.capture());
        assertThat(captor.getValue().offset()).isEqualTo(10);
    }

    @Test
    void run_hasMoreTrue_printsNextOffsetHintToStderr() {
        SearchResult r = new SearchResult(
                new com.repograph.core.model.CodeUnit("id", CodeUnitKind.METHOD, "java",
                        "Foo#bar", "bar", "Foo.java", 1, 5, "", "Foo#bar",
                        List.of(), null, java.util.Map.of()),
                0.8f);
        when(vectorStore.semanticSearch(any(), any()))
                .thenReturn(new SearchPage(List.of(r), 0, 1, true));

        ByteArrayOutputStream errBuf = new ByteArrayOutputStream();
        PrintStream oldErr = System.err;
        System.setErr(new PrintStream(errBuf));
        try {
            cli.execute("query", "--limit", "1");
        } finally {
            System.setErr(oldErr);
        }

        assertThat(errBuf.toString()).contains("--offset").contains("next page");
    }
}
