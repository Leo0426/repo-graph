package com.repograph.asset;

import com.repograph.app.pipeline.IndexHistoryStore;
import com.repograph.app.watcher.FileWatcherService;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.AssetBusyException;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.finding.TriageDataCleanup;
import com.repograph.core.pipeline.IndexOptions;
import com.repograph.core.pipeline.IndexPipeline;
import com.repograph.core.pipeline.IndexResult;
import com.repograph.core.pipeline.IndexStore;
import com.repograph.core.scanner.ExternalScanService;
import com.repograph.vuln.VulnStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link DefaultAssetImportService} 端到端资产生命周期测试。
 *
 * @author leolu
 */
class DefaultAssetImportServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void importArchive_extractsAndMakesCompletedIndexQueryable() throws Exception {
        Fixture fixture = fixture(Runnable::run);
        when(fixture.indexPipeline.index(any(Path.class), any(IndexOptions.class)))
                .thenReturn(sampleResult());
        Path upload = createZip("demo/src/Main.java", "class Main {}");

        ImportedAsset receipt;
        try (InputStream input = Files.newInputStream(upload)) {
            receipt = fixture.service.importArchive(
                    input, "demo.zip", Files.size(upload), IndexOptions.defaults());
        }

        assertThat(receipt.status()).isEqualTo(AssetStatus.INDEXING);
        ImportedAsset completed = fixture.service.find(receipt.assetId()).orElseThrow();
        assertThat(completed.status()).isEqualTo(AssetStatus.READY);
        assertThat(completed.indexResult()).isEqualTo(sampleResult());
        assertThat(completed.projectRoot().resolve("src/Main.java")).hasContent("class Main {}");
        assertThat(upload).exists();
    }

    @Test
    void failedIndexKeepsSourceAndExposesFailure() throws Exception {
        Fixture fixture = fixture(Runnable::run);
        when(fixture.indexPipeline.index(any(Path.class), any(IndexOptions.class)))
                .thenThrow(new IllegalStateException("embedding unavailable"));
        Path upload = createZip("demo/Main.java", "class Main {}");

        ImportedAsset receipt;
        try (InputStream input = Files.newInputStream(upload)) {
            receipt = fixture.service.importArchive(
                    input, "demo.zip", Files.size(upload), IndexOptions.defaults());
        }

        ImportedAsset failed = fixture.service.find(receipt.assetId()).orElseThrow();
        assertThat(failed.status()).isEqualTo(AssetStatus.FAILED);
        assertThat(failed.error()).isEqualTo("embedding unavailable");
        assertThat(failed.projectRoot()).exists();
    }

    @Test
    void deleteRemovesOnlyRegisteredAssetTreeAndDelegatesIndexCleanup() throws Exception {
        Fixture fixture = fixture(Runnable::run);
        when(fixture.indexPipeline.index(any(Path.class), any(IndexOptions.class)))
                .thenReturn(sampleResult());
        Path external = Files.writeString(tempDir.resolve("keep.txt"), "keep");
        Path upload = createZip("demo/Main.java", "class Main {}");
        ImportedAsset receipt;
        try (InputStream input = Files.newInputStream(upload)) {
            receipt = fixture.service.importArchive(
                    input, "demo.zip", Files.size(upload), IndexOptions.defaults());
        }
        ImportedAsset ready = fixture.service.find(receipt.assetId()).orElseThrow();
        Path managedAssetRoot = fixture.properties.rootDir().resolve(receipt.assetId());

        assertThat(fixture.service.delete(receipt.assetId())).isTrue();

        assertThat(managedAssetRoot).doesNotExist();
        assertThat(fixture.properties.rootDir()).exists();
        assertThat(external).hasContent("keep");
        assertThat(upload).exists();
        assertThat(fixture.service.find(receipt.assetId())).isEmpty();
        verify(fixture.indexStore).removeProject(ready.projectId());
        verify(fixture.vulnStore).removeProject(ready.projectId());
        verify(fixture.externalScanService).removeProject(ready.projectId());
        verify(fixture.triageDataCleanup).removeProject(ready.projectId());
        verify(fixture.fileWatcherService).stop(ready.projectId());
    }

    @Test
    void deleteRejectsAssetWhileIndexTaskIsQueued() throws Exception {
        List<Runnable> queued = new ArrayList<>();
        Fixture fixture = fixture(queued::add);
        Path upload = createZip("demo/Main.java", "class Main {}");
        ImportedAsset receipt;
        try (InputStream input = Files.newInputStream(upload)) {
            receipt = fixture.service.importArchive(
                    input, "demo.zip", Files.size(upload), IndexOptions.defaults());
        }

        assertThatThrownBy(() -> fixture.service.delete(receipt.assetId()))
                .isInstanceOf(AssetBusyException.class);
        assertThat(queued).hasSize(1);
    }

    @Test
    void failedIndexCleanupStopsWatcherButPreservesRegisteredSourceForRetry() throws Exception {
        Fixture fixture = fixture(Runnable::run);
        when(fixture.indexPipeline.index(any(Path.class), any(IndexOptions.class)))
                .thenReturn(sampleResult());
        Path upload = createZip("demo/Main.java", "class Main {}");
        ImportedAsset receipt;
        try (InputStream input = Files.newInputStream(upload)) {
            receipt = fixture.service.importArchive(
                    input, "demo.zip", Files.size(upload), IndexOptions.defaults());
        }
        doThrow(new IllegalStateException("vector storage unavailable"))
                .when(fixture.indexStore).removeProject(receipt.projectId());

        assertThatThrownBy(() -> fixture.service.delete(receipt.assetId()))
                .isInstanceOf(IllegalStateException.class);

        var order = inOrder(fixture.fileWatcherService, fixture.indexStore);
        order.verify(fixture.fileWatcherService).stop(receipt.projectId());
        order.verify(fixture.indexStore).removeProject(receipt.projectId());
        assertThat(fixture.service.find(receipt.assetId())).isPresent();
        assertThat(receipt.projectRoot().resolve("Main.java")).hasContent("class Main {}");
        verifyNoInteractions(fixture.vulnStore, fixture.externalScanService, fixture.triageDataCleanup);
    }

    @Test
    void cleanupManagedProject_removesRegistrationAfterCallerDeletedIndexes() throws Exception {
        Fixture fixture = fixture(Runnable::run);
        when(fixture.indexPipeline.index(any(Path.class), any(IndexOptions.class)))
                .thenReturn(sampleResult());
        Path upload = createZip("demo/Main.java", "class Main {}");
        ImportedAsset receipt;
        try (InputStream input = Files.newInputStream(upload)) {
            receipt = fixture.service.importArchive(
                    input, "demo.zip", Files.size(upload), IndexOptions.defaults());
        }
        ImportedAsset ready = fixture.service.find(receipt.assetId()).orElseThrow();

        fixture.service.validateProjectDeletion(ready.projectId());
        fixture.service.cleanupManagedProject(ready.projectId());

        assertThat(fixture.service.find(receipt.assetId())).isEmpty();
        assertThat(fixture.properties.rootDir().resolve(receipt.assetId())).doesNotExist();
        verify(fixture.indexStore, never()).removeProject(anyString());
        verifyNoInteractions(fixture.vulnStore);
        verify(fixture.externalScanService).removeProject(ready.projectId());
        verify(fixture.fileWatcherService).stop(ready.projectId());
    }

    @Test
    void deleteKeepsMutationBoundaryUntilAllManagedResourcesAreRemoved() throws Exception {
        Fixture fixture = fixture(Runnable::run);
        when(fixture.indexPipeline.index(any(Path.class), any(IndexOptions.class)))
                .thenReturn(sampleResult());
        Path upload = createZip("demo/Main.java", "class Main {}");
        ImportedAsset receipt;
        try (InputStream input = Files.newInputStream(upload)) {
            receipt = fixture.service.importArchive(
                    input, "demo.zip", Files.size(upload), IndexOptions.defaults());
        }
        AtomicBoolean insideMutation = new AtomicBoolean();
        AtomicBoolean completedMutation = new AtomicBoolean();
        when(fixture.indexStore.withProjectMutation(eq(receipt.projectId()), any()))
                .thenAnswer(invocation -> {
                    insideMutation.set(true);
                    try {
                        Object result = invocation.<Supplier<?>>getArgument(1).get();
                        assertThat(fixture.service.find(receipt.assetId())).isEmpty();
                        assertThat(fixture.properties.rootDir().resolve(receipt.assetId())).doesNotExist();
                        completedMutation.set(true);
                        return result;
                    } finally {
                        insideMutation.set(false);
                    }
                });
        org.mockito.stubbing.Answer<Void> assertCoordinated = invocation -> {
            assertThat(insideMutation.get()).as("asset cleanup must hold the project mutation boundary").isTrue();
            return null;
        };
        doAnswer(assertCoordinated).when(fixture.fileWatcherService).stop(receipt.projectId());
        doAnswer(assertCoordinated).when(fixture.indexStore).removeProject(receipt.projectId());
        doAnswer(assertCoordinated).when(fixture.vulnStore).removeProject(receipt.projectId());
        doAnswer(assertCoordinated).when(fixture.externalScanService).removeProject(receipt.projectId());
        doAnswer(assertCoordinated).when(fixture.triageDataCleanup).removeProject(receipt.projectId());

        assertThat(fixture.service.delete(receipt.assetId())).isTrue();
        assertThat(completedMutation.get()).isTrue();
    }

    @Test
    void cleanupUnmanagedProjectStillStopsItsWatcherInsideMutation() {
        Fixture fixture = fixture(Runnable::run);
        AtomicBoolean insideMutation = new AtomicBoolean();
        when(fixture.indexStore.withProjectMutation(eq("external-project"), any()))
                .thenAnswer(invocation -> {
                    insideMutation.set(true);
                    try {
                        return invocation.<Supplier<?>>getArgument(1).get();
                    } finally {
                        insideMutation.set(false);
                    }
                });
        doAnswer(invocation -> {
            assertThat(insideMutation.get()).isTrue();
            return null;
        }).when(fixture.fileWatcherService).stop("external-project");

        fixture.service.cleanupManagedProject("external-project");

        verify(fixture.fileWatcherService).stop("external-project");
        verify(fixture.indexStore, never()).removeProject(anyString());
        verifyNoInteractions(fixture.externalScanService, fixture.vulnStore, fixture.triageDataCleanup);
    }

    private Fixture fixture(Executor executor) {
        Path db = tempDir.resolve("db-" + System.nanoTime() + ".sqlite");
        ArchiveProperties properties = new ArchiveProperties(
                tempDir.resolve("managed-" + System.nanoTime()), 200, 1024, 50_000, 50, 32);
        ImportedAssetStore assetStore = new ImportedAssetStore(db.toString());
        IndexHistoryStore historyStore = new IndexHistoryStore(db.toString());
        IndexPipeline pipeline = mock(IndexPipeline.class);
        IndexStore indexStore = mock(IndexStore.class);
        when(indexStore.withProjectMutation(anyString(), any()))
                .thenAnswer(invocation -> invocation.<Supplier<?>>getArgument(1).get());
        VulnStore vulnStore = mock(VulnStore.class);
        ExternalScanService externalScanService = mock(ExternalScanService.class);
        TriageDataCleanup triageDataCleanup = mock(TriageDataCleanup.class);
        FileWatcherService watcher = mock(FileWatcherService.class);
        DefaultAssetImportService service = new DefaultAssetImportService(
                properties,
                new SafeArchiveExtractor(properties),
                assetStore,
                pipeline,
                historyStore,
                indexStore,
                vulnStore,
                externalScanService,
                triageDataCleanup,
                watcher,
                executor);
        return new Fixture(
                service,
                properties,
                pipeline,
                indexStore,
                vulnStore,
                externalScanService,
                triageDataCleanup,
                watcher);
    }

    private Path createZip(String name, String content) throws Exception {
        Path archive = tempDir.resolve("upload-" + System.nanoTime() + ".zip");
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(archive))) {
            zip.putNextEntry(new ZipEntry(name));
            zip.write(content.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        return archive;
    }

    private static IndexResult sampleResult() {
        return new IndexResult(1, 1, 0, 0, 1, 0, 10, List.of());
    }

    private record Fixture(
            DefaultAssetImportService service,
            ArchiveProperties properties,
            IndexPipeline indexPipeline,
            IndexStore indexStore,
            VulnStore vulnStore,
            ExternalScanService externalScanService,
            TriageDataCleanup triageDataCleanup,
            FileWatcherService fileWatcherService
    ) {}
}
