package com.repograph.app.pipeline;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.model.RelationEdge;
import com.repograph.core.parser.ParseResult;
import com.repograph.core.pipeline.IndexOptions;
import com.repograph.core.pipeline.IndexStore;
import com.repograph.core.pipeline.IndexResult;
import com.repograph.core.parser.ParseStrategy;
import com.repograph.core.vector.EmbeddingService;
import com.repograph.core.vector.VectorStore;
import com.repograph.app.watcher.FileWatcherService;
import com.repograph.framework.FrameworkDetector;
import com.repograph.graph.CodeGraph;
import com.repograph.parser.ParserDispatcher;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ApplicationEventPublisher;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link DefaultIndexPipeline} 单元测试，验证索引管道的编排逻辑。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DefaultIndexPipelineTest {

    @TempDir
    Path projectRoot;

    @Mock
    ParserDispatcher parserDispatcher;
    @Mock
    FrameworkDetector frameworkDetector;
    @Mock
    CodeGraph codeGraph;
    @Mock
    EmbeddingService embeddingService;
    @Mock
    VectorStore vectorStore;
    @Mock
    IncrementalIndexCache incrementalCache;
    @Mock
    IndexStore indexStore;
    @Mock
    ObjectProvider<FileWatcherService> fileWatcherServiceProvider;
    @Mock
    ApplicationEventPublisher eventPublisher;

    private DefaultIndexPipeline pipeline;
    private EmbeddingUpsertRunner embeddingUpsertRunner;

    @BeforeEach
    void setUp() {
        SourceFileScanner sourceFileScanner = new SourceFileScanner();
        embeddingUpsertRunner = new EmbeddingUpsertRunner(embeddingService, vectorStore, null);
        pipeline = new DefaultIndexPipeline(
                parserDispatcher, frameworkDetector, codeGraph,
                incrementalCache, indexStore, sourceFileScanner, embeddingUpsertRunner,
                fileWatcherServiceProvider, eventPublisher);
    }

    @AfterEach
    void tearDown() {
        embeddingUpsertRunner.shutdown();
    }

    private static CodeUnit unit(String qn) {
        return new CodeUnit("id-" + qn, CodeUnitKind.CLASS, "java",
                qn, qn, "Foo.java", 1, 10, "class Foo {}", "class Foo",
                List.of(), null, Map.of());
    }

    // ── index() ───────────────────────────────────────────────────────────────

    @Test
    void index_emptyDirectory_returnsZeroFiles() {
        IndexResult result = pipeline.index(projectRoot, null);

        assertThat(result.totalFiles()).isEqualTo(0);
        assertThat(result.totalUnits()).isEqualTo(0);
        verify(parserDispatcher, never()).dispatch(any(), any());
    }

    @Test
    void index_javaFile_parsesAndUpserts() throws Exception {
        Path javaFile = Files.createTempFile(projectRoot, "Foo", ".java");
        Files.writeString(javaFile, "public class Foo {}");

        CodeUnit unit = unit("com.example.Foo");
        ParseResult parseResult = ParseResult.of(List.of(unit), List.of(), "MockParser");
        when(parserDispatcher.dispatch(any(), any())).thenReturn(parseResult);
        when(frameworkDetector.detect(any())).thenReturn(Map.of());
        when(embeddingService.embed(anyList())).thenReturn(List.of(new float[]{0.1f, 0.2f}));
        when(incrementalCache.filterChanged(anyList(), any(), any()))
                .thenAnswer(inv -> inv.getArgument(0));

        IndexResult result = pipeline.index(projectRoot, null);

        assertThat(result.totalFiles()).isEqualTo(1);
        assertThat(result.totalUnits()).isEqualTo(1);
        verify(vectorStore, atLeastOnce()).upsert(anyList(), any());
        verify(codeGraph).addUnits(anyList(), any());
    }

    @Test
    void index_noFilesChanged_skipsParsingWhenIncremental() throws Exception {
        Path javaFile = Files.createTempFile(projectRoot, "Foo", ".java");
        Files.writeString(javaFile, "public class Foo {}");

        when(incrementalCache.filterChanged(anyList(), any(), any()))
                .thenReturn(List.of()); // all files unchanged

        IndexOptions opts = new IndexOptions(List.of(), ParseStrategy.AUTO, true, null);
        IndexResult result = pipeline.index(projectRoot, opts);

        assertThat(result.skippedFiles()).isEqualTo(1);
        verify(parserDispatcher, never()).dispatch(any(), any());
    }

    @Test
    void index_nonIncremental_removesOldProjectBeforeRebuild() throws Exception {
        Path javaFile = Files.createTempFile(projectRoot, "Foo", ".java");
        Files.writeString(javaFile, "public class Foo {}");
        when(parserDispatcher.dispatch(any(), any())).thenReturn(ParseResult.empty());
        when(frameworkDetector.detect(any())).thenReturn(Map.of());

        pipeline.index(projectRoot, new IndexOptions(List.of("java"), ParseStrategy.AUTO, false, null));

        verify(indexStore).removeProject(any());
    }

    @Test
    void index_incremental_removesFilesMissingFromCurrentScan() throws Exception {
        Path javaFile = Files.createTempFile(projectRoot, "Foo", ".java");
        Files.writeString(javaFile, "public class Foo {}");
        when(codeGraph.findFilePaths(any())).thenReturn(
                java.util.Set.of("old/module/Legacy.java", javaFile.getFileName().toString()));
        when(incrementalCache.filterChanged(anyList(), any(), any())).thenReturn(List.of());

        pipeline.index(projectRoot, IndexOptions.defaults());

        verify(indexStore).removeFile("old/module/Legacy.java",
                com.repograph.core.util.ProjectIdUtil.generateProjectId(projectRoot));
    }

    @Test
    void index_parseError_recordsErrorAndContinues() throws Exception {
        Files.createTempFile(projectRoot, "Foo", ".java");

        when(incrementalCache.filterChanged(anyList(), any(), any()))
                .thenAnswer(inv -> inv.getArgument(0));
        when(parserDispatcher.dispatch(any(), any()))
                .thenThrow(new RuntimeException("parse failed"));
        when(frameworkDetector.detect(any())).thenReturn(Map.of());

        IndexResult result = pipeline.index(projectRoot, null);

        assertThat(result.errors()).isNotEmpty();
    }

    @Test
    void index_graphSavedAfterIndexing() throws Exception {
        Files.createTempFile(projectRoot, "Foo", ".java");

        when(incrementalCache.filterChanged(anyList(), any(), any()))
                .thenAnswer(inv -> inv.getArgument(0));
        when(parserDispatcher.dispatch(any(), any())).thenReturn(ParseResult.empty());
        when(frameworkDetector.detect(any())).thenReturn(Map.of());

        pipeline.index(projectRoot, null);

        verify(codeGraph).addUnits(anyList(), any());
    }

    // ── indexFile() ───────────────────────────────────────────────────────────

    @Test
    void indexFile_singleFile_parsesAndUpserts() throws Exception {
        Path javaFile = Files.createTempFile(projectRoot, "Bar", ".java");
        Files.writeString(javaFile, "public class Bar {}");

        CodeUnit unit = unit("com.example.Bar");
        when(parserDispatcher.dispatch(any(), any()))
                .thenReturn(ParseResult.of(List.of(unit), List.of(), "MockParser"));
        when(frameworkDetector.detect(any())).thenReturn(Map.of());
        when(embeddingService.embed(anyList())).thenReturn(List.of(new float[]{0.5f}));

        IndexResult result = pipeline.indexFile(javaFile, projectRoot, null);

        assertThat(result.totalFiles()).isEqualTo(1);
        assertThat(result.parsedFiles()).isEqualTo(1);
        assertThat(result.totalUnits()).isEqualTo(1);
        verify(indexStore).removeFile(any(), any());
        verify(codeGraph).addUnits(anyList(), any());
    }

    @Test
    void indexFile_updatesIncrementalCache() throws Exception {
        Path javaFile = Files.createTempFile(projectRoot, "Cached", ".java");
        Files.writeString(javaFile, "public class Cached {}");

        when(parserDispatcher.dispatch(any(), any())).thenReturn(ParseResult.empty());
        when(frameworkDetector.detect(any())).thenReturn(Map.of());

        pipeline.indexFile(javaFile, projectRoot, null);

        verify(incrementalCache).updateEntries(anyList(), any(), any());
    }

    @Test
    void indexFile_parseError_returnsErrorInResult() throws Exception {
        Path javaFile = Files.createTempFile(projectRoot, "Bad", ".java");

        when(parserDispatcher.dispatch(any(), any()))
                .thenThrow(new RuntimeException("syntax error"));
        when(frameworkDetector.detect(any())).thenReturn(Map.of());

        IndexResult result = pipeline.indexFile(javaFile, projectRoot, null);

        assertThat(result.errors()).hasSize(1);
        assertThat(result.errors().get(0)).contains("syntax error");
    }

    // ── Language filter ───────────────────────────────────────────────────────

    @Test
    void index_withLanguageFilter_onlyScansMatchingExtensions() throws Exception {
        Files.createTempFile(projectRoot, "Foo", ".java");
        Files.createTempFile(projectRoot, "script", ".py");

        when(incrementalCache.filterChanged(anyList(), any(), any()))
                .thenAnswer(inv -> inv.getArgument(0));
        when(parserDispatcher.dispatch(any(), any())).thenReturn(ParseResult.empty());
        when(frameworkDetector.detect(any())).thenReturn(Map.of());

        IndexOptions opts = new IndexOptions(List.of("java"), ParseStrategy.AUTO, false, null);
        IndexResult result = pipeline.index(projectRoot, opts);

        assertThat(result.totalFiles()).isEqualTo(1);
    }

    @Test
    void index_allLanguages_scansJavaAndPythonAndC() throws Exception {
        Files.createTempFile(projectRoot, "Foo", ".java");
        Files.createTempFile(projectRoot, "main", ".c");
        Files.createTempFile(projectRoot, "script", ".py");

        when(incrementalCache.filterChanged(anyList(), any(), any()))
                .thenAnswer(inv -> inv.getArgument(0));
        when(parserDispatcher.dispatch(any(), any())).thenReturn(ParseResult.empty());
        when(frameworkDetector.detect(any())).thenReturn(Map.of());

        IndexResult result = pipeline.index(projectRoot, null); // null → all languages

        assertThat(result.totalFiles()).isEqualTo(3);
    }

    // ── Graph edge building ───────────────────────────────────────────────────

    @Test
    void index_withEdgesFromParsing_addsEdgesToGraph() throws Exception {
        Files.createTempFile(projectRoot, "Foo", ".java");

        CodeUnit unitA = unit("com.example.A");
        CodeUnit unitB = unit("com.example.B");
        RelationEdge edge = new RelationEdge(
                unitA.id(), unitB.id(), EdgeKind.CALLS, true, "Foo.java", 5);

        when(incrementalCache.filterChanged(anyList(), any(), any()))
                .thenAnswer(inv -> inv.getArgument(0));
        when(parserDispatcher.dispatch(any(), any()))
                .thenReturn(ParseResult.of(List.of(unitA, unitB), List.of(edge), "MockParser"));
        when(frameworkDetector.detect(any())).thenReturn(Map.of());
        when(embeddingService.embed(anyList()))
                .thenReturn(List.of(new float[]{0.1f, 0.2f}, new float[]{0.3f, 0.4f}));

        pipeline.index(projectRoot, null);

        verify(codeGraph).addEdges(argThat(list -> list.contains(edge)));
    }
}
