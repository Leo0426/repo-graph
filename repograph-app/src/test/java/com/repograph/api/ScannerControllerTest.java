package com.repograph.api;

import com.repograph.core.asset.AssetFileCategory;
import com.repograph.core.asset.AssetImportService;
import com.repograph.core.asset.AssetProfileService;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ClassifiedAssetFile;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.asset.ProjectAssetProfile;
import com.repograph.core.asset.ScannerPlanItem;
import com.repograph.core.scanner.ExternalScanBatchResult;
import com.repograph.core.scanner.ExternalScanOptions;
import com.repograph.core.scanner.ExternalScanService;
import com.repograph.core.scanner.ScanBatchStatus;
import com.repograph.core.scanner.ScannerAvailability;
import com.repograph.core.scanner.ScannerCapability;
import com.repograph.core.scanner.ScannerRunResult;
import com.repograph.core.scanner.ScannerRunStatus;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.TestPropertySource;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link ScannerController} REST 契约测试。
 *
 * @author leolu
 */
@WebMvcTest(ScannerController.class)
@TestPropertySource(properties = "repograph.scanners.default-timeout-seconds=300")
class ScannerControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    AssetImportService assetImportService;

    @MockBean
    AssetProfileService assetProfileService;

    @MockBean
    ExternalScanService externalScanService;

    @Test
    void scan_usesReadyAssetProfileAndReturnsIndependentRuns() throws Exception {
        ImportedAsset asset = asset();
        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset));
        when(assetProfileService.build(any(), any())).thenReturn(profile());
        when(externalScanService.scan(any(), any())).thenReturn(batch());

        mvc.perform(post("/api/v1/assets/asset-1/scans")
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PARTIAL"))
                .andExpect(jsonPath("$.runs[0].scanner").value("SEMGREP"))
                .andExpect(jsonPath("$.runs[1].scanner").value("CODEQL"));

        ArgumentCaptor<ExternalScanOptions> options = ArgumentCaptor.forClass(ExternalScanOptions.class);
        verify(externalScanService).scan(any(), options.capture());
        assertThat(options.getValue().scanners()).containsExactlyInAnyOrder("SEMGREP", "CODEQL");
        assertThat(options.getValue().languages()).containsExactly("java");
        assertThat(options.getValue().timeoutSeconds()).isEqualTo(300);
    }

    @Test
    void scan_returnsNotFoundForUnknownAsset() throws Exception {
        when(assetImportService.find("missing")).thenReturn(Optional.empty());

        mvc.perform(post("/api/v1/assets/missing/scans")
                        .contentType("application/json")
                        .content("{\"scanners\":[\"SEMGREP\"]}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void capabilitiesAndPersistedResultsAreQueryable() throws Exception {
        when(externalScanService.capabilities()).thenReturn(List.of(new ScannerAvailability(
                new ScannerCapability("SEMGREP", List.of("java"), "semgrep", "semgrep-json", List.of()),
                false, "", "command not found")));
        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset()));
        when(externalScanService.listRuns("project-1")).thenReturn(batch().runs());
        when(externalScanService.listFindings("project-1")).thenReturn(List.of());

        mvc.perform(get("/api/v1/scanners/capabilities"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].available").value(false))
                .andExpect(jsonPath("$[0].error").isNotEmpty());
        mvc.perform(get("/api/v1/assets/asset-1/scans"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].scanner").value("SEMGREP"));
        mvc.perform(get("/api/v1/assets/asset-1/external-findings"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());
    }

    private static ExternalScanBatchResult batch() {
        String now = "2026-07-26T10:00:02Z";
        ScannerRunResult semgrep = new ScannerRunResult(
                "batch-1-semgrep", "project-1", "SEMGREP", ScannerRunStatus.SUCCEEDED,
                "1.0", 0, 100, now, now, List.of(), "");
        ScannerRunResult codeql = new ScannerRunResult(
                "batch-1-codeql", "project-1", "CODEQL", ScannerRunStatus.FAILED,
                "2.0", 2, 200, now, now, List.of(), "analysis failed");
        return new ExternalScanBatchResult(
                "batch-1", "project-1", ScanBatchStatus.PARTIAL, List.of(semgrep, codeql));
    }

    private static ProjectAssetProfile profile() {
        return new ProjectAssetProfile(
                "asset-1", "project-1", Path.of("/managed/asset-1/source"), "2026-07-26T10:00:02Z",
                1, Map.of("BUSINESS", 1L), Map.of("java", 1L),
                List.of(new ClassifiedAssetFile(
                        "App.java", AssetFileCategory.BUSINESS, "recognized source", "java", 10)),
                List.of(), List.of("maven"), List.of(), List.of(),
                List.of(
                        new ScannerPlanItem("SEMGREP", true, "AUTO", "applicable"),
                        new ScannerPlanItem("CODEQL", true, "AUTO", "applicable"),
                        new ScannerPlanItem("SLITHER", false, "AUTO", "not applicable")),
                List.of());
    }

    private static ImportedAsset asset() {
        return new ImportedAsset(
                "asset-1", "project-1", "demo.zip", "ZIP", Path.of("/managed/asset-1/source"),
                AssetStatus.READY, "", "2026-07-26T10:00:00Z", "2026-07-26T10:00:01Z", null);
    }
}
