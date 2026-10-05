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
import java.util.Set;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
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
        lenient().when(indexStore.withProjectMutation(any(), any()))
                .thenAnswer(invocation -> invocation.<Supplier<?>>getArgument(1).get());
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
        return unit(qn, "Foo.java");
    }

    private static CodeUnit unit(String qn, String filePath) {
        return new CodeUnit("id-" + qn, CodeUnitKind.CLASS, "java",
                qn, qn, filePath, 1, 10, "class Foo {}", "class Foo",
                List.of(), null, Map.of());
    }

    private DefaultIndexPipeline withPersistentCache(IncrementalIndexCache cache) {
        return new DefaultIndexPipeline(parserDispatcher, frameworkDetector, codeGraph, cache,
                new DefaultIndexStore(codeGraph, vectorStore, cache), new SourceFileScanner(), embeddingUpsertRunner,
                fileWatcherServiceProvider, eventPublisher);
    }

    @Test
    void failedVectorWrite_isRetriedWithoutEditingSource() throws Exception {
        Path file = projectRoot.resolve("Foo.java");
        Files.writeString(file, "class Foo {}");
        IncrementalIndexCache cache = new IncrementalIndexCache(projectRoot.resolve("cache.db").toString());
        DefaultIndexPipeline realCachePipeline = new DefaultIndexPipeline(
                parserDispatcher, frameworkDetector, codeGraph, cache, indexStore,
                new SourceFileScanner(), embeddingUpsertRunner, fileWatcherServiceProvider, eventPublisher);
        when(parserDispatcher.dispatch(any(), any()))
                .thenReturn(ParseResult.of(List.of(unit("Foo")), List.of(), "fixture"));
        when(embeddingService.embed(anyList())).thenReturn(List.of(new float[]{0.1f}));
        org.mockito.Mockito.doThrow(new IllegalStateException("vector unavailable"))
                .doNothing().when(vectorStore).upsert(anyList(), any());

        assertThat(realCachePipeline.index(projectRoot, null).errors()).isNotEmpty();
        IndexResult retry = realCachePipeline.index(projectRoot, null);
        assertThat(retry.parsedFiles()).isEqualTo(1);
        assertThat(retry.errors()).isEmpty();
        assertThat(realCachePipeline.index(projectRoot, null).skippedFiles()).isEqualTo(1);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"parse", "graph"})
    void unsuccessfulStageDoesNotCommitFingerprint(String stage) throws Exception {
        Path file = projectRoot.resolve("Foo.java");
        Files.writeString(file, "class Foo {}");
        IncrementalIndexCache cache = new IncrementalIndexCache(projectRoot.resolve("stages.db").toString());
        DefaultIndexPipeline subject = new DefaultIndexPipeline(parserDispatcher, frameworkDetector,
                codeGraph, cache, indexStore, new SourceFileScanner(), embeddingUpsertRunner,
                fileWatcherServiceProvider, eventPublisher);
        ParseResult parsed = ParseResult.of(List.of(unit("Foo")), List.of(), "fixture");
        when(parserDispatcher.dispatch(any(), any())).thenReturn(parsed);
        when(embeddingService.embed(anyList())).thenReturn(List.of(new float[]{0.1f}));
        if (stage.equals("parse")) {
            when(parserDispatcher.dispatch(any(), any())).thenThrow(new IllegalStateException("parse failed"))
                    .thenReturn(parsed);
        } else {
            org.mockito.Mockito.doThrow(new IllegalStateException("graph failed")).doNothing()
                    .when(codeGraph).replaceFiles(anyMap(), anyList(), any());
        }
        assertThat(subject.indexFile(file, projectRoot, null).errors()).isNotEmpty();
        assertThat(subject.index(projectRoot, null).parsedFiles()).isEqualTo(1);
        assertThat(subject.index(projectRoot, null).skippedFiles()).isEqualTo(1);
    }

    @Test
    void partialRunCachesSuccessfulFilesOnly() throws Exception {
        Path good = projectRoot.resolve("Foo.java");
        Path bad = projectRoot.resolve("Broken.java");
        Files.writeString(good, "class Foo {}");
        Files.writeString(bad, "class Broken {}");
        IncrementalIndexCache cache = new IncrementalIndexCache(projectRoot.resolve("partial.db").toString());
        DefaultIndexPipeline subject = new DefaultIndexPipeline(parserDispatcher, frameworkDetector,
                codeGraph, cache, indexStore, new SourceFileScanner(), embeddingUpsertRunner,
                fileWatcherServiceProvider, eventPublisher);
        when(parserDispatcher.dispatch(org.mockito.ArgumentMatchers.eq(good), any()))
                .thenReturn(ParseResult.of(List.of(unit("Foo")), List.of(), "fixture"));
        when(parserDispatcher.dispatch(org.mockito.ArgumentMatchers.eq(bad), any()))
                .thenThrow(new IllegalStateException("parse failed"))
                .thenReturn(ParseResult.of(List.of(), List.of(), "fixture"));
        when(embeddingService.embed(anyList())).thenReturn(List.of(new float[]{0.1f}));
        assertThat(subject.index(projectRoot, null).errors()).hasSize(1);
        IndexResult retry = subject.index(projectRoot, null);
        assertThat(retry.parsedFiles()).isEqualTo(1);
        assertThat(retry.skippedFiles()).isEqualTo(1);
        assertThat(retry.errors()).isEmpty();
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void languageFilteredIndexPreservesExistingFilesOutsideScan(boolean javaOnly) throws Exception {
        Path javaFile = projectRoot.resolve("Foo.java");
        Path pythonFile = projectRoot.resolve("worker.py");
        Path document = projectRoot.resolve("README.md");
        Files.writeString(javaFile, "class Foo {}");
        Files.writeString(pythonFile, "def work(): pass");
        Files.writeString(document, "# Existing documentation");
        String projectId = com.repograph.core.util.ProjectIdUtil.generateProjectId(projectRoot);
        IncrementalIndexCache cache = new IncrementalIndexCache(projectRoot.resolve("filtered.db").toString());
        cache.updateEntries(List.of(javaFile, pythonFile, document), projectId, projectRoot);
        when(codeGraph.findFilePaths(projectId)).thenReturn(java.util.Set.of("Foo.java", "worker.py", "README.md"));
        DefaultIndexPipeline subject = new DefaultIndexPipeline(parserDispatcher, frameworkDetector,
                codeGraph, cache, new DefaultIndexStore(codeGraph, vectorStore, cache), new SourceFileScanner(),
                embeddingUpsertRunner, fileWatcherServiceProvider, eventPublisher);

        IndexResult result = subject.index(projectRoot,
                new IndexOptions(javaOnly ? List.of("java") : List.of(), ParseStrategy.AUTO, true, null));

        assertThat(result.errors()).isEmpty();
        assertThat(cache.filterChanged(List.of(pythonFile, document), projectId, projectRoot)).isEmpty();
        verify(codeGraph, never()).removeByFile("worker.py", projectId);
        verify(vectorStore, never()).removeByFile("README.md", projectId);
    }

    @Test
    void sourceReplacedByDirectoryRemovesItsStaleIndex() throws Exception {
        Path source = projectRoot.resolve("worker.py");
        Files.writeString(source, "def work(): pass");
        String projectId = com.repograph.core.util.ProjectIdUtil.generateProjectId(projectRoot);
        IncrementalIndexCache cache = new IncrementalIndexCache(projectRoot.resolve("directory.db").toString());
        cache.updateEntries(List.of(source), projectId, projectRoot);
        when(codeGraph.findFilePaths(projectId)).thenReturn(java.util.Set.of("worker.py"));
        DefaultIndexPipeline subject = new DefaultIndexPipeline(parserDispatcher, frameworkDetector,
                codeGraph, cache, new DefaultIndexStore(codeGraph, vectorStore, cache), new SourceFileScanner(),
                embeddingUpsertRunner, fileWatcherServiceProvider, eventPublisher);
        Files.delete(source);
        Files.createDirectory(source);

        assertThat(subject.index(projectRoot, IndexOptions.defaults()).errors()).isEmpty();

        assertThat(cache.findDeletedPaths(List.of(), projectId, projectRoot)).isEmpty();
        verify(codeGraph).removeByFile("worker.py", projectId);
        verify(vectorStore).removeByFile("worker.py", projectId);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void sourceChangedDuringEmbeddingRemainsEligibleForRetry(boolean singleFile) throws Exception {
        Path file = projectRoot.resolve("Foo.java");
        Files.writeString(file, "class Foo {}");
        String projectId = com.repograph.core.util.ProjectIdUtil.generateProjectId(projectRoot);
        IncrementalIndexCache cache = new IncrementalIndexCache(
                projectRoot.resolve("changed-during-index.db").toString());
        DefaultIndexPipeline subject = new DefaultIndexPipeline(parserDispatcher, frameworkDetector,
                codeGraph, cache, indexStore, new SourceFileScanner(), embeddingUpsertRunner,
                fileWatcherServiceProvider, eventPublisher);
        when(parserDispatcher.dispatch(any(), any()))
                .thenReturn(ParseResult.of(List.of(unit("Foo")), List.of(), "fixture"));
        java.util.concurrent.atomic.AtomicBoolean changed = new java.util.concurrent.atomic.AtomicBoolean();
        when(embeddingService.embed(anyList())).thenAnswer(invocation -> {
            if (changed.compareAndSet(false, true)) {
                Files.writeString(file, "class Foo { void addedAfterParsing() {} }");
            }
            return List.of(new float[]{0.1f});
        });

        IndexResult result = singleFile
                ? subject.indexFile(file, projectRoot, null)
                : subject.index(projectRoot, null);

        assertThat(cache.filterChanged(List.of(file), projectId, projectRoot)).containsExactly(file);
        assertThat(result.errors()).anyMatch(error -> error.contains("changed during indexing"));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void successfullyParsedEmptyFileReplacesGraphAndPrunesAllVectors(boolean singleFile) throws Exception {
        Path file = projectRoot.resolve("Foo.java");
        Files.writeString(file, "class Foo {}");
        String projectId = com.repograph.core.util.ProjectIdUtil.generateProjectId(projectRoot);
        IncrementalIndexCache cache = new IncrementalIndexCache(projectRoot.resolve("empty-file.db").toString());
        cache.updateEntries(List.of(file), projectId, projectRoot);
        Files.writeString(file, "");
        DefaultIndexPipeline subject = withPersistentCache(cache);
        when(parserDispatcher.dispatch(eq(file), any()))
                .thenReturn(ParseResult.of(List.of(), List.of(), "fixture"));

        IndexResult result = singleFile
                ? subject.indexFile(file, projectRoot, null)
                : subject.index(projectRoot, null);

        assertThat(result.errors()).isEmpty();
        verify(codeGraph).replaceFiles(Map.of("Foo.java", List.of()), List.of(), projectId);
        verify(vectorStore).removeStaleByFile("Foo.java", projectId, Set.of());
        verify(vectorStore, never()).upsert(anyList(), any());
        verify(embeddingService, never()).embed(anyList());
        assertThat(cache.filterChanged(List.of(file), projectId, projectRoot)).isEmpty();
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void parseFailureLeavesExistingGraphAndVectorsUntouched(boolean singleFile) throws Exception {
        Path file = projectRoot.resolve("Foo.java");
        Files.writeString(file, "class Foo {}");
        String projectId = com.repograph.core.util.ProjectIdUtil.generateProjectId(projectRoot);
        IncrementalIndexCache cache = new IncrementalIndexCache(projectRoot.resolve("parse-failure.db").toString());
        cache.updateEntries(List.of(file), projectId, projectRoot);
        Files.writeString(file, "class Foo {");
        DefaultIndexPipeline subject = new DefaultIndexPipeline(parserDispatcher, frameworkDetector,
                codeGraph, cache, indexStore, new SourceFileScanner(), embeddingUpsertRunner,
                fileWatcherServiceProvider, eventPublisher);
        when(parserDispatcher.dispatch(eq(file), any())).thenReturn(ParseResult.empty());

        IndexResult result = singleFile
                ? subject.indexFile(file, projectRoot, null)
                : subject.index(projectRoot, null);

        assertThat(result.errors()).isNotEmpty();
        verify(indexStore, never()).removeFile(any(), any());
        verify(codeGraph, never()).removeByFile(any(), any());
        verify(codeGraph, never()).replaceFiles(anyMap(), anyList(), any());
        verifyNoInteractions(embeddingService, vectorStore);
        assertThat(cache.filterChanged(List.of(file), projectId, projectRoot)).containsExactly(file);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void graphReplacementFailureSkipsVectorChangesAndRemainsRetryable(boolean singleFile) throws Exception {
        Path file = projectRoot.resolve("Foo.java");
        Files.writeString(file, "class Foo {}");
        IncrementalIndexCache cache = new IncrementalIndexCache(projectRoot.resolve("graph-failure.db").toString());
        DefaultIndexPipeline subject = withPersistentCache(cache);
        when(parserDispatcher.dispatch(eq(file), any()))
                .thenReturn(ParseResult.of(List.of(unit("Foo")), List.of(), "fixture"));
        when(embeddingService.embed(anyList())).thenReturn(List.of(new float[]{0.1f}));
        doThrow(new IllegalStateException("graph unavailable")).doNothing()
                .when(codeGraph).replaceFiles(anyMap(), anyList(), any());

        IndexResult failed = singleFile
                ? subject.indexFile(file, projectRoot, null)
                : subject.index(projectRoot, null);

        assertThat(failed.errors()).isNotEmpty();
        verifyNoInteractions(embeddingService, vectorStore);
        IndexResult retry = subject.index(projectRoot, null);
        assertThat(retry.errors()).isEmpty();
        assertThat(retry.parsedFiles()).isEqualTo(1);
        assertThat(subject.index(projectRoot, null).skippedFiles()).isEqualTo(1);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void vectorPruneFailurePersistsDirtyFileAcrossCacheRestart(boolean singleFile) throws Exception {
        Path file = projectRoot.resolve("Foo.java");
        Files.writeString(file, "class Foo {}");
        String projectId = com.repograph.core.util.ProjectIdUtil.generateProjectId(projectRoot);
        Path database = projectRoot.resolve("prune-retry.db");
        IncrementalIndexCache cache = new IncrementalIndexCache(database.toString());
        DefaultIndexPipeline subject = withPersistentCache(cache);
        when(parserDispatcher.dispatch(eq(file), any()))
                .thenReturn(ParseResult.of(List.of(unit("Foo")), List.of(), "fixture"));
        when(embeddingService.embed(anyList())).thenReturn(List.of(new float[]{0.1f}));
        doThrow(new IllegalStateException("vector cleanup unavailable")).doNothing()
                .when(vectorStore).removeStaleByFile("Foo.java", projectId, Set.of("id-Foo"));

        IndexResult failed = singleFile
                ? subject.indexFile(file, projectRoot, null)
                : subject.index(projectRoot, null);

        assertThat(failed.errors()).isNotEmpty();
        var order = inOrder(vectorStore);
        order.verify(vectorStore).upsert(anyList(), eq(projectId));
        order.verify(vectorStore).removeStaleByFile("Foo.java", projectId, Set.of("id-Foo"));
        IncrementalIndexCache reopened = new IncrementalIndexCache(database.toString());
        assertThat(reopened.findDeletedPaths(List.of(), projectId, projectRoot)).containsExactly("Foo.java");
        assertThat(reopened.filterChanged(List.of(file), projectId, projectRoot)).containsExactly(file);
        DefaultIndexPipeline resumed = withPersistentCache(reopened);
        IndexResult retry = resumed.index(projectRoot, null);
        assertThat(retry.errors()).isEmpty();
        assertThat(retry.parsedFiles()).isEqualTo(1);
        assertThat(resumed.index(projectRoot, null).skippedFiles()).isEqualTo(1);
    }

    @Test
    void deletedDirtyFileIsRetriedAfterRestartEvenWhenGraphHasNoRemainingNode() {
        String projectId = com.repograph.core.util.ProjectIdUtil.generateProjectId(projectRoot);
        Path database = projectRoot.resolve("deleted-dirty.db");
        IncrementalIndexCache cache = new IncrementalIndexCache(database.toString());
        cache.markDirty(List.of("Deleted.java"), projectId);
        when(codeGraph.findFilePaths(projectId)).thenReturn(Set.of());
        doThrow(new IllegalStateException("deleted vectors unavailable")).doNothing()
                .when(vectorStore).removeByFile("Deleted.java", projectId);

        IndexResult failed = withPersistentCache(cache).index(projectRoot, null);

        assertThat(failed.errors()).anyMatch(error -> error.contains("Deleted file cleanup failed"));
        IncrementalIndexCache reopened = new IncrementalIndexCache(database.toString());
        assertThat(reopened.findDeletedPaths(List.of(), projectId, projectRoot)).containsExactly("Deleted.java");

        IndexResult retry = withPersistentCache(reopened).index(projectRoot, null);

        assertThat(retry.errors()).isEmpty();
        assertThat(retry.totalFiles()).isZero();
        assertThat(reopened.findDeletedPaths(List.of(), projectId, projectRoot)).isEmpty();
        verify(vectorStore, times(2)).removeByFile("Deleted.java", projectId);
        verify(codeGraph, never()).replaceFiles(anyMap(), anyList(), any());
        verify(vectorStore, never()).upsert(anyList(), any());
        verifyNoInteractions(parserDispatcher, embeddingService);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void dirtyMarkerFailurePreventsGraphAndVectorMutations(boolean singleFile) throws Exception {
        Path file = projectRoot.resolve("Foo.java");
        Files.writeString(file, "class Foo {}");
        when(incrementalCache.filterChanged(anyList(), any(), any())).thenReturn(List.of(file));
        when(parserDispatcher.dispatch(eq(file), any()))
                .thenReturn(ParseResult.of(List.of(unit("Foo")), List.of(), "fixture"));
        doThrow(new IllegalStateException("dirty marker could not be persisted"))
                .when(incrementalCache).markDirty(eq(List.of("Foo.java")), any());

        assertThatThrownBy(() -> {
            if (singleFile) {
                pipeline.indexFile(file, projectRoot, null);
            } else {
                pipeline.index(projectRoot, null);
            }
        }).isInstanceOf(IllegalStateException.class).hasMessageContaining("dirty marker");

        verify(codeGraph, never()).recordProject(any(), any());
        verify(codeGraph, never()).replaceFiles(anyMap(), anyList(), any());
        verify(codeGraph, never()).removeByFile(any(), any());
        verify(indexStore, never()).removeFile(any(), any());
        verifyNoInteractions(embeddingService, vectorStore);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void pendingProjectDeletionMustCompleteBeforeNewWrites(boolean singleFile) throws Exception {
        Path file = projectRoot.resolve("Foo.java");
        Files.writeString(file, "class Foo {}");
        String projectId = com.repograph.core.util.ProjectIdUtil.generateProjectId(projectRoot);
        Path database = projectRoot.resolve("pending-project.db");
        IncrementalIndexCache cache = new IncrementalIndexCache(database.toString());
        cache.markProjectDeletionPending(projectId);
        DefaultIndexPipeline subject = withPersistentCache(cache);
        when(parserDispatcher.dispatch(eq(file), any()))
                .thenReturn(ParseResult.of(List.of(unit("Foo")), List.of(), "fixture"));
        when(embeddingService.embed(anyList())).thenReturn(List.of(new float[]{0.1f}));
        doThrow(new IllegalStateException("project vector deletion unavailable")).doNothing()
                .when(vectorStore).removeByProject(projectId);

        assertThatThrownBy(() -> {
            if (singleFile) {
                subject.indexFile(file, projectRoot, null);
            } else {
                subject.index(projectRoot, null);
            }
        }).isInstanceOf(IllegalStateException.class).hasMessageContaining("project vector deletion");

        verify(parserDispatcher, never()).dispatch(any(), any());
        verify(codeGraph, never()).replaceFiles(anyMap(), anyList(), any());
        verify(vectorStore, never()).upsert(anyList(), any());
        verify(vectorStore, never()).removeStaleByFile(any(), any(), anySet());
        IncrementalIndexCache reopened = new IncrementalIndexCache(database.toString());
        assertThat(reopened.hasPendingProjectDeletion(projectId)).isTrue();
        clearInvocations(codeGraph, vectorStore, parserDispatcher);

        IndexResult retry = withPersistentCache(reopened).index(projectRoot, null);

        assertThat(retry.errors()).isEmpty();
        assertThat(retry.parsedFiles()).isEqualTo(1);
        var order = inOrder(codeGraph, vectorStore, parserDispatcher);
        order.verify(codeGraph).removeByProject(projectId);
        order.verify(vectorStore).removeByProject(projectId);
        order.verify(parserDispatcher).dispatch(eq(file), any());
        order.verify(codeGraph).replaceFiles(anyMap(), anyList(), eq(projectId));
        order.verify(vectorStore).upsert(anyList(), eq(projectId));
        assertThat(reopened.hasPendingProjectDeletion(projectId)).isFalse();
        assertThat(reopened.filterChanged(List.of(file), projectId, projectRoot)).isEmpty();
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
        Path javaFile = projectRoot.resolve("Foo.java");
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
        verify(codeGraph).replaceFiles(eq(Map.of("Foo.java", List.of(unit))), eq(List.of()), any());
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
        when(parserDispatcher.dispatch(any(), any())).thenReturn(ParseResult.of(List.of(), List.of(), "fixture"));
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
        Files.writeString(projectRoot.resolve("Foo.java"), "");

        when(incrementalCache.filterChanged(anyList(), any(), any()))
                .thenAnswer(inv -> inv.getArgument(0));
        when(parserDispatcher.dispatch(any(), any())).thenReturn(ParseResult.of(List.of(), List.of(), "fixture"));
        when(frameworkDetector.detect(any())).thenReturn(Map.of());

        pipeline.index(projectRoot, null);

        verify(codeGraph).replaceFiles(eq(Map.of("Foo.java", List.of())), eq(List.of()), any());
    }

    // ── indexFile() ───────────────────────────────────────────────────────────

    @Test
    void indexFile_singleFile_parsesAndUpserts() throws Exception {
        Path javaFile = projectRoot.resolve("Bar.java");
        Files.writeString(javaFile, "public class Bar {}");

        CodeUnit unit = unit("com.example.Bar", "Bar.java");
        when(parserDispatcher.dispatch(any(), any()))
                .thenReturn(ParseResult.of(List.of(unit), List.of(), "MockParser"));
        when(frameworkDetector.detect(any())).thenReturn(Map.of());
        when(embeddingService.embed(anyList())).thenReturn(List.of(new float[]{0.5f}));

        IndexResult result = pipeline.indexFile(javaFile, projectRoot, null);

        assertThat(result.totalFiles()).isEqualTo(1);
        assertThat(result.parsedFiles()).isEqualTo(1);
        assertThat(result.totalUnits()).isEqualTo(1);
        verify(indexStore, never()).removeFile(any(), any());
        verify(codeGraph).replaceFiles(eq(Map.of("Bar.java", List.of(unit))), eq(List.of()), any());
    }

    @Test
    void indexFile_updatesIncrementalCache() throws Exception {
        Path javaFile = Files.createTempFile(projectRoot, "Cached", ".java");
        Files.writeString(javaFile, "public class Cached {}");
        IncrementalIndexCache cache = new IncrementalIndexCache(projectRoot.resolve("single-file.db").toString());
        DefaultIndexPipeline subject = new DefaultIndexPipeline(parserDispatcher, frameworkDetector,
                codeGraph, cache, indexStore, new SourceFileScanner(), embeddingUpsertRunner,
                fileWatcherServiceProvider, eventPublisher);

        when(parserDispatcher.dispatch(any(), any())).thenReturn(ParseResult.of(List.of(), List.of(), "fixture"));
        when(frameworkDetector.detect(any())).thenReturn(Map.of());

        assertThat(subject.indexFile(javaFile, projectRoot, null).errors()).isEmpty();

        assertThat(cache.filterChanged(List.of(javaFile),
                com.repograph.core.util.ProjectIdUtil.generateProjectId(projectRoot), projectRoot)).isEmpty();
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
        Files.writeString(projectRoot.resolve("Foo.java"), "class Foo {}");

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

        verify(codeGraph).replaceFiles(eq(Map.of("Foo.java", List.of(unitA, unitB))),
                argThat(list -> list.contains(edge)), any());
    }
}
