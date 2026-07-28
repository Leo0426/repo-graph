package com.repograph.api;

import com.repograph.asset.ArchiveLimitException;
import com.repograph.core.asset.AssetBusyException;
import com.repograph.asset.UnsafeArchiveException;
import com.repograph.asset.UnsupportedArchiveException;
import com.repograph.core.asset.AssetFileCategory;
import com.repograph.core.asset.AssetImportService;
import com.repograph.core.asset.AssetNotReadyException;
import com.repograph.core.asset.AssetProfileService;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ClassifiedAssetFile;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.asset.ProjectAssetProfile;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import java.io.InputStream;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link AssetController} REST 契约测试。
 *
 * @author leolu
 */
@WebMvcTest(AssetController.class)
class AssetControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    AssetImportService assetImportService;

    @MockBean
    AssetProfileService assetProfileService;

    @Test
    void importArchive_returnsAcceptedReceipt() throws Exception {
        when(assetImportService.importArchive(
                any(InputStream.class), anyString(), anyLong(), any()))
                .thenReturn(asset(AssetStatus.INDEXING));
        MockMultipartFile file = new MockMultipartFile(
                "file", "demo.zip", "application/zip", new byte[]{1, 2, 3});

        mvc.perform(multipart("/api/v1/assets/import")
                        .file(file)
                        .param("lang", "java,python"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.assetId").value("asset-1"))
                .andExpect(jsonPath("$.projectId").value("project-1"))
                .andExpect(jsonPath("$.status").value("INDEXING"))
                .andExpect(jsonPath("$.pollUrl").value("/api/v1/assets/asset-1"));
    }

    @Test
    void find_returnsPersistedStatusAndNotFound() throws Exception {
        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset(AssetStatus.READY)));
        when(assetImportService.find("missing")).thenReturn(Optional.empty());

        mvc.perform(get("/api/v1/assets/asset-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("READY"));
        mvc.perform(get("/api/v1/assets/missing"))
                .andExpect(status().isNotFound());
    }

    @Test
    void profile_returnsCurrentAssetProfileAndAppliesScannerOverrides() throws Exception {
        ImportedAsset asset = asset(AssetStatus.READY);
        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset));
        when(assetProfileService.build(any(), any())).thenReturn(profile());

        mvc.perform(get("/api/v1/assets/asset-1/profile")
                        .param("includeScanner", "SLITHER")
                        .param("excludeScanner", "SEMGREP"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assetId").value("asset-1"))
                .andExpect(jsonPath("$.categoryDistribution.BUSINESS").value(1))
                .andExpect(jsonPath("$.files[0].reason").isNotEmpty());
    }

    @Test
    void profile_returnsNotFoundForUnknownAsset() throws Exception {
        when(assetImportService.find("missing")).thenReturn(Optional.empty());

        mvc.perform(get("/api/v1/assets/missing/profile"))
                .andExpect(status().isNotFound());
    }

    @Test
    void profile_returnsConflictWhileAssetIsNotReady() throws Exception {
        ImportedAsset asset = asset(AssetStatus.INDEXING);
        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset));
        when(assetProfileService.build(any(), any()))
                .thenThrow(new AssetNotReadyException("still indexing"));

        mvc.perform(get("/api/v1/assets/asset-1/profile"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_NOT_READY"));
    }

    @Test
    void delete_returnsConflictWhileIndexing() throws Exception {
        when(assetImportService.delete("asset-1"))
                .thenThrow(new AssetBusyException("still indexing"));

        mvc.perform(delete("/api/v1/assets/asset-1"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_BUSY"));
    }

    @Test
    void archiveFailuresMapToStableHttpStatuses() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file", "demo.bin", "application/octet-stream", new byte[]{1});

        doThrow(new UnsafeArchiveException("unsafe path"))
                .when(assetImportService).importArchive(any(), anyString(), anyLong(), any());
        mvc.perform(multipart("/api/v1/assets/import").file(file))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ARCHIVE_UNSAFE"));

        doThrow(new UnsupportedArchiveException("unsupported"))
                .when(assetImportService).importArchive(any(), anyString(), anyLong(), any());
        mvc.perform(multipart("/api/v1/assets/import").file(file))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("ARCHIVE_UNSUPPORTED"));

        doThrow(new ArchiveLimitException("too large"))
                .when(assetImportService).importArchive(any(), anyString(), anyLong(), any());
        mvc.perform(multipart("/api/v1/assets/import").file(file))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("ARCHIVE_LIMIT_EXCEEDED"));
    }

    private static ImportedAsset asset(AssetStatus status) {
        return new ImportedAsset(
                "asset-1", "project-1", "demo.zip", "ZIP",
                Path.of("/managed/asset-1/source/demo"),
                status, "", "2026-07-26T10:00:00Z", "2026-07-26T10:00:01Z", null);
    }

    private static ProjectAssetProfile profile() {
        return new ProjectAssetProfile(
                "asset-1",
                "project-1",
                Path.of("/managed/asset-1/source/demo"),
                "2026-07-26T10:00:02Z",
                1,
                Map.of("BUSINESS", 1L),
                Map.of("java", 1L),
                List.of(new ClassifiedAssetFile(
                        "src/App.java", AssetFileCategory.BUSINESS, "recognized source file", "java", 10)),
                List.of("spring"),
                List.of("maven"),
                List.of(),
                List.of(),
                List.of(),
                List.of());
    }
}
