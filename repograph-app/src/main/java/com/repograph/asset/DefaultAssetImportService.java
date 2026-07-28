package com.repograph.asset;

import com.repograph.app.pipeline.IndexHistoryStore;
import com.repograph.app.watcher.FileWatcherService;
import com.repograph.core.asset.ArchiveExtractRequest;
import com.repograph.core.asset.ArchiveExtractResult;
import com.repograph.core.asset.ArchiveExtractor;
import com.repograph.core.asset.AssetImportService;
import com.repograph.core.asset.AssetBusyException;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.finding.TriageDataCleanup;
import com.repograph.core.pipeline.IndexOptions;
import com.repograph.core.pipeline.IndexPipeline;
import com.repograph.core.pipeline.IndexResult;
import com.repograph.core.pipeline.IndexStore;
import com.repograph.core.scanner.ExternalScanService;
import com.repograph.core.util.ProjectIdUtil;
import com.repograph.vuln.VulnStore;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executor;

/**
 * 归档资产接入默认实现：落盘、提取、注册、异步索引和安全清理。
 *
 * @author leolu
 */
@Service
public class DefaultAssetImportService implements AssetImportService {

    private static final int COPY_BUFFER_SIZE = 8192;

    private final ArchiveProperties properties;
    private final ArchiveExtractor archiveExtractor;
    private final ImportedAssetStore assetStore;
    private final IndexPipeline indexPipeline;
    private final IndexHistoryStore indexHistoryStore;
    private final IndexStore indexStore;
    private final VulnStore vulnStore;
    private final ExternalScanService externalScanService;
    private final TriageDataCleanup triageDataCleanup;
    private final FileWatcherService fileWatcherService;
    private final Executor executor;

    /**
     * 创建归档资产接入服务。
     *
     * @param properties         归档安全配置
     * @param archiveExtractor   安全提取边界
     * @param assetStore         资产注册表
     * @param indexPipeline      索引管道
     * @param indexHistoryStore 索引历史存储
     * @param indexStore         图、向量与缓存删除边界
     * @param vulnStore          漏洞记录存储
     * @param externalScanService 外部扫描记录删除边界
     * @param triageDataCleanup 研判反馈和规则策略删除边界
     * @param fileWatcherService 文件监听服务
     * @param executor           资产索引专用执行器
     */
    public DefaultAssetImportService(
            ArchiveProperties properties,
            ArchiveExtractor archiveExtractor,
            ImportedAssetStore assetStore,
            IndexPipeline indexPipeline,
            IndexHistoryStore indexHistoryStore,
            IndexStore indexStore,
            VulnStore vulnStore,
            ExternalScanService externalScanService,
            TriageDataCleanup triageDataCleanup,
            FileWatcherService fileWatcherService,
            @Qualifier("assetIndexExecutor") Executor executor) {
        this.properties = properties;
        this.archiveExtractor = archiveExtractor;
        this.assetStore = assetStore;
        this.indexPipeline = indexPipeline;
        this.indexHistoryStore = indexHistoryStore;
        this.indexStore = indexStore;
        this.vulnStore = vulnStore;
        this.externalScanService = externalScanService;
        this.triageDataCleanup = triageDataCleanup;
        this.fileWatcherService = fileWatcherService;
        this.executor = executor;
    }

    @Override
    public ImportedAsset importArchive(InputStream input, String originalFileName,
                                       long contentLength, IndexOptions options) {
        if (input == null) {
            throw new IllegalArgumentException("Archive file is required");
        }
        if (contentLength > properties.maxUploadBytes()) {
            throw new ArchiveLimitException("Archive exceeds max upload size");
        }

        String assetId = UUID.randomUUID().toString();
        Path assetRoot = controlledAssetRoot(assetId);
        Path upload = assetRoot.resolve("upload.bin");
        Path extractionRoot = assetRoot.resolve("source");
        try {
            Files.createDirectories(assetRoot);
            long storedBytes = copyUpload(input, upload);
            ArchiveExtractResult extracted = archiveExtractor.extract(
                    new ArchiveExtractRequest(upload, extractionRoot, storedBytes));
            Files.deleteIfExists(upload);

            String projectId = ProjectIdUtil.generateProjectId(extracted.projectRoot());
            String now = Instant.now().toString();
            ImportedAsset asset = new ImportedAsset(
                    assetId,
                    projectId,
                    displayFileName(originalFileName),
                    extracted.archiveType(),
                    extracted.projectRoot(),
                    AssetStatus.INDEXING,
                    "",
                    now,
                    now,
                    null);
            assetStore.save(asset);
            IndexOptions indexOptions = options != null ? options : IndexOptions.defaults();
            try {
                executor.execute(() -> runIndex(asset, indexOptions));
            } catch (RuntimeException e) {
                assetStore.delete(assetId);
                throw e;
            }
            return asset;
        } catch (ArchiveLimitException | UnsafeArchiveException
                 | UnsupportedArchiveException | InvalidArchiveException e) {
            cleanupFailedImport(assetRoot, e);
            throw e;
        } catch (IOException e) {
            cleanupFailedImport(assetRoot, e);
            throw new InvalidArchiveException("Failed to store uploaded archive", e);
        } catch (RuntimeException e) {
            cleanupFailedImport(assetRoot, e);
            throw e;
        }
    }

    @Override
    public Optional<ImportedAsset> find(String assetId) {
        return assetStore.findById(assetId).map(this::withIndexResult);
    }

    @Override
    public boolean delete(String assetId) {
        Optional<ImportedAsset> found = assetStore.findById(assetId);
        if (found.isEmpty()) {
            return false;
        }
        deleteRegisteredAsset(found.get());
        return true;
    }

    @Override
    public void validateProjectDeletion(String projectId) {
        assetStore.findByProjectId(projectId).ifPresent(asset -> {
            if (asset.status() == AssetStatus.INDEXING) {
                throw new AssetBusyException("Asset is still indexing: " + asset.assetId());
            }
        });
    }

    @Override
    public void cleanupManagedProject(String projectId) {
        assetStore.findByProjectId(projectId).ifPresent(this::cleanupRegistration);
    }

    private long copyUpload(InputStream input, Path target) throws IOException {
        long total = 0;
        byte[] buffer = new byte[COPY_BUFFER_SIZE];
        try (OutputStream output = Files.newOutputStream(
                target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > properties.maxUploadBytes()) {
                    throw new ArchiveLimitException("Archive exceeds max upload size");
                }
                output.write(buffer, 0, read);
            }
        }
        if (total == 0) {
            throw new InvalidArchiveException("Archive is empty");
        }
        return total;
    }

    private void runIndex(ImportedAsset asset, IndexOptions options) {
        String projectRoot = asset.projectRoot().toString();
        try {
            IndexResult result = indexPipeline.index(asset.projectRoot(), options);
            indexHistoryStore.save(projectRoot, "done", result);
            assetStore.updateStatus(asset.assetId(), AssetStatus.READY, "");
        } catch (Exception e) {
            String error = safeError(e);
            indexHistoryStore.save(projectRoot, "error: " + error, null);
            assetStore.updateStatus(asset.assetId(), AssetStatus.FAILED, error);
        }
    }

    private ImportedAsset withIndexResult(ImportedAsset asset) {
        if (asset.status() != AssetStatus.READY) {
            return asset;
        }
        IndexResult result = indexHistoryStore.load(asset.projectRoot().toString())
                .map(IndexHistoryStore.IndexHistory::result)
                .orElse(null);
        return new ImportedAsset(
                asset.assetId(), asset.projectId(), asset.originalFileName(), asset.archiveType(),
                asset.projectRoot(), asset.status(), asset.error(), asset.createdAt(), asset.updatedAt(), result);
    }

    private void deleteRegisteredAsset(ImportedAsset asset) {
        if (asset.status() == AssetStatus.INDEXING) {
            throw new AssetBusyException("Asset is still indexing: " + asset.assetId());
        }
        Path assetRoot = controlledAssetRoot(asset.assetId());
        Path projectRoot = asset.projectRoot().toAbsolutePath().normalize();
        if (!projectRoot.startsWith(assetRoot)) {
            throw new IllegalStateException("Refusing to delete untrusted asset path: " + projectRoot);
        }
        fileWatcherService.stop(asset.projectId());
        indexStore.removeProject(asset.projectId());
        vulnStore.removeProject(asset.projectId());
        externalScanService.removeProject(asset.projectId());
        triageDataCleanup.removeProject(asset.projectId());
        indexHistoryStore.remove(projectRoot.toString());
        ManagedFileTree.deleteIfExists(assetRoot);
        assetStore.delete(asset.assetId());
    }

    private void cleanupRegistration(ImportedAsset asset) {
        if (asset.status() == AssetStatus.INDEXING) {
            throw new AssetBusyException("Asset is still indexing: " + asset.assetId());
        }
        Path assetRoot = controlledAssetRoot(asset.assetId());
        Path projectRoot = asset.projectRoot().toAbsolutePath().normalize();
        if (!projectRoot.startsWith(assetRoot)) {
            throw new IllegalStateException("Refusing to delete untrusted asset path: " + projectRoot);
        }
        fileWatcherService.stop(asset.projectId());
        externalScanService.removeProject(asset.projectId());
        indexHistoryStore.remove(projectRoot.toString());
        ManagedFileTree.deleteIfExists(assetRoot);
        assetStore.delete(asset.assetId());
    }

    private Path controlledAssetRoot(String assetId) {
        Path root = properties.rootDir().toAbsolutePath().normalize();
        Path assetRoot = root.resolve(assetId).normalize();
        if (!assetRoot.getParent().equals(root)) {
            throw new IllegalStateException("Invalid managed asset identifier");
        }
        return assetRoot;
    }

    private static String displayFileName(String originalFileName) {
        if (originalFileName == null || originalFileName.isBlank()) {
            return "upload";
        }
        String sanitized = originalFileName.replace('\r', '_').replace('\n', '_');
        return sanitized.length() <= 255 ? sanitized : sanitized.substring(0, 255);
    }

    private static String safeError(Exception exception) {
        String message = exception.getMessage();
        return message == null || message.isBlank()
                ? exception.getClass().getSimpleName()
                : message;
    }

    private static void cleanupFailedImport(Path assetRoot, Throwable cause) {
        try {
            ManagedFileTree.deleteIfExists(assetRoot);
        } catch (RuntimeException cleanupFailure) {
            cause.addSuppressed(cleanupFailure);
        }
    }
}
