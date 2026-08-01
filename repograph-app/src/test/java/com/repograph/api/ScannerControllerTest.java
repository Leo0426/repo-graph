package com.repograph.api;

import com.repograph.core.asset.AssetFileCategory;
import com.repograph.core.asset.AssetImportService;
import com.repograph.core.asset.AssetProfileService;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ClassifiedAssetFile;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.asset.ProjectAssetProfile;
import com.repograph.core.asset.ScannerPlanItem;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.scanner.ExternalScanBatchResult;
import com.repograph.core.scanner.ExternalScanOptions;
import com.repograph.core.scanner.ExternalScanService;
import com.repograph.core.scanner.ScanBatchStatus;
import com.repograph.core.scanner.ScanTask;
import com.repograph.core.scanner.ScanTaskFindingsPage;
import com.repograph.core.scanner.ScanTaskNotFoundException;
import com.repograph.core.scanner.ScanTaskService;
import com.repograph.core.scanner.ScanTaskStatus;
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

    @MockBean
    ScanTaskService scanTaskService;

    @Test
    void submitScanTask_returns202WithQueuedTaskId() throws Exception {
        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset()));
        when(assetProfileService.build(any(), any())).thenReturn(profile());
        when(scanTaskService.submit(any(), any())).thenReturn(new ScanTask(
                "task-1", "project-1", "asset-1", List.of("SEMGREP", "CODEQL"),
                List.of("java"), 300, ScanTaskStatus.QUEUED, 1, "", "",
                "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z"));

        mvc.perform(post("/api/v1/assets/asset-1/scan-tasks")
                        .contentType("application/json").content("{}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.taskId").value("task-1"))
                .andExpect(jsonPath("$.status").value("QUEUED"));
        verify(scanTaskService).submit(any(), any());
    }

    @Test
    void submitScanTask_returns404ForUnknownAsset() throws Exception {
        when(assetImportService.find("missing")).thenReturn(Optional.empty());

        mvc.perform(post("/api/v1/assets/missing/scan-tasks")
                        .contentType("application/json").content("{\"scanners\":[\"SEMGREP\"]}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void scanTaskStatus_projectsPerScannerSummaries() throws Exception {
        when(scanTaskService.find("task-1")).thenReturn(Optional.of(new ScanTask(
                "task-1", "project-1", "asset-1", List.of("SEMGREP", "CODEQL"),
                List.of("java"), 300, ScanTaskStatus.PARTIAL, 1, "", "",
                "2026-08-01T00:00:00Z", "2026-08-01T00:00:09Z")));
        when(scanTaskService.result("task-1")).thenReturn(Optional.of(batch()));

        mvc.perform(get("/api/v1/scan-tasks/task-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PARTIAL"))
                .andExpect(jsonPath("$.scanners[0].scanner").value("SEMGREP"))
                .andExpect(jsonPath("$.scanners[0].status").value("SUCCEEDED"))
                .andExpect(jsonPath("$.scanners[1].scanner").value("CODEQL"))
                .andExpect(jsonPath("$.scanners[1].status").value("FAILED"))
                .andExpect(jsonPath("$.scanners[1].error").value("analysis failed"));
    }

    @Test
    void scanTaskStatus_returns404ForUnknownTask() throws Exception {
        when(scanTaskService.find("nope")).thenReturn(Optional.empty());

        mvc.perform(get("/api/v1/scan-tasks/nope"))
                .andExpect(status().isNotFound());
    }

    @Test
    void scanTaskFindings_returnsPage() throws Exception {
        when(scanTaskService.find("task-1")).thenReturn(Optional.of(new ScanTask(
                "task-1", "project-1", "asset-1", List.of("SEMGREP"),
                List.of("java"), 300, ScanTaskStatus.SUCCEEDED, 1, "", "",
                "2026-08-01T00:00:00Z", "2026-08-01T00:00:09Z")));
        ExternalFinding finding = new ExternalFinding("SEMGREP", "rule-a", "CWE-79",
                ExternalFindingSeverity.MEDIUM, "msg", "A.java", 10, 10, "sym", List.of(), "{}");
        when(scanTaskService.findings("task-1", 0, 50))
                .thenReturn(new ScanTaskFindingsPage(List.of(finding), 0, 50, 3));

        mvc.perform(get("/api/v1/scan-tasks/task-1/findings").param("page", "0").param("size", "50"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(3))
                .andExpect(jsonPath("$.findings", org.hamcrest.Matchers.hasSize(1)))
                .andExpect(jsonPath("$.findings[0].ruleId").value("rule-a"));
    }

    @Test
    void cancelScanTask_returnsCancelledStatus() throws Exception {
        when(scanTaskService.cancel("task-1")).thenReturn(new ScanTask(
                "task-1", "project-1", "asset-1", List.of("SEMGREP"),
                List.of("java"), 300, ScanTaskStatus.CANCELLED, 1, "", "",
                "2026-08-01T00:00:00Z", "2026-08-01T00:00:05Z"));

        mvc.perform(post("/api/v1/scan-tasks/task-1/cancel"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.taskId").value("task-1"))
                .andExpect(jsonPath("$.status").value("CANCELLED"));
    }

    @Test
    void cancelScanTask_returns404ForUnknownTask() throws Exception {
        when(scanTaskService.cancel("nope"))
                .thenThrow(new ScanTaskNotFoundException("scan task not found: nope"));

        mvc.perform(post("/api/v1/scan-tasks/nope/cancel"))
                .andExpect(status().isNotFound());
    }

    @Test
    void retryScanTask_returnsRequeuedTask() throws Exception {
        when(scanTaskService.retry("task-1")).thenReturn(new ScanTask(
                "task-1", "project-1", "asset-1", List.of("SEMGREP", "CODEQL"),
                List.of("java"), 300, ScanTaskStatus.QUEUED, 2, "", "",
                "2026-08-01T00:00:00Z", "2026-08-01T00:00:10Z"));

        mvc.perform(post("/api/v1/scan-tasks/task-1/retry"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.taskId").value("task-1"))
                .andExpect(jsonPath("$.status").value("QUEUED"));
    }

    @Test
    void retryScanTask_returns400ForNonRetryableStatus() throws Exception {
        when(scanTaskService.retry("task-1"))
                .thenThrow(new IllegalArgumentException("scan task not retryable in status SUCCEEDED"));

        mvc.perform(post("/api/v1/scan-tasks/task-1/retry"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void retryScanTask_returns404ForUnknownTask() throws Exception {
        when(scanTaskService.retry("nope"))
                .thenThrow(new ScanTaskNotFoundException("scan task not found: nope"));

        mvc.perform(post("/api/v1/scan-tasks/nope/retry"))
                .andExpect(status().isNotFound());
    }

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
