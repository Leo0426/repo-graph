package com.repograph.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.finding.ReportSnapshot;
import com.repograph.core.finding.ReviewQueueAuditEvent;
import com.repograph.core.finding.ReviewQueueEntry;
import com.repograph.core.finding.ReviewStatus;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
import com.repograph.core.retrieval.ContextPack;
import com.repograph.finding.ExternalFindingImporter;
import com.repograph.finding.FindingContextService;
import com.repograph.finding.ReportPdfRenderer;
import com.repograph.finding.ReviewQueueStore;
import com.repograph.finding.TriageReportService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.info.BuildProperties;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link ReviewQueueController} REST 契约测试。
 *
 * @author leolu
 */
@org.springframework.context.annotation.Import(TriageWorkflowTestConfiguration.class)
@WebMvcTest(ReviewQueueController.class)
class ReviewQueueControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    ExternalFindingImporter importer;

    @MockitoBean
    FindingContextService findingContextService;

    @MockitoBean
    TriageReportService triageReportService;

    @MockitoBean
    ReviewQueueStore reviewQueueStore;

    @MockitoBean
    BuildProperties buildProperties;

    @MockitoBean
    ReportPdfRenderer reportPdfRenderer;

    @MockitoBean
    com.repograph.finding.TriageFeedbackStore feedbackStore;

    @MockitoBean
    com.repograph.finding.RuleSuppressionStore ruleSuppressionStore;

    @Autowired
    ObjectMapper objectMapper;

    @Test
    void submitSnapshot_buildsReportsAndSubmitsToQueue() throws Exception {
        ExternalFinding finding = finding();
        FindingContext context = new FindingContext(finding, true,
                "com.example.OrderService#run()", emptyPack());
        TriageReport report = new TriageReport(finding, true,
                "com.example.OrderService#run()", TriageVerdict.TRUE_RISK, 0.7f,
                List.of("报警定位到 [C1]"), List.of(), "使用 ProcessBuilder",
                "该报警大概率是真实风险", emptyPack());
        ReviewQueueEntry entry = new ReviewQueueEntry(
                "entry-1", "snap-1", "p1", finding.fingerprint(), finding.ruleId(), "CWE-78",
                ExternalFindingSeverity.HIGH, TriageVerdict.TRUE_RISK, 0.7f,
                ReviewStatus.PENDING, "", "", "2026-07-28T00:00:00Z");

        when(importer.supports("semgrep")).thenReturn(true);
        when(importer.importJson(any(java.io.InputStream.class), anyInt())).thenReturn(List.of(finding));
        when(findingContextService.build(eq(finding), any())).thenReturn(context);
        var feedback = new com.repograph.core.finding.TriageFeedback(finding.fingerprint(), "p1",
                com.repograph.core.finding.TriageFeedbackStatus.FALSE_POSITIVE, "reviewer", "validated",
                "commit-a", "rules-a", "2026-09-16T00:00:00Z");
        when(feedbackStore.findByFingerprint("p1", finding.fingerprint())).thenReturn(Optional.of(feedback));
        when(triageReportService.build(eq(context), any())).thenReturn(report);
        when(buildProperties.getVersion()).thenReturn("0.5.0-test");
        when(reviewQueueStore.submit(any())).thenReturn(List.of(entry));

        mvc.perform(post("/api/v1/review-queue/snapshots")
                        .param("format", "semgrep")
                        .param("projectId", "p1")
                        .param("codeVersion", "commit-a")
                        .param("ruleVersion", "rules-a")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"results\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].id").value("entry-1"))
                .andExpect(jsonPath("$.entries[0].status").value("PENDING"));
        org.mockito.Mockito.verify(triageReportService).build(eq(context),
                org.mockito.ArgumentMatchers.argThat(review -> review.projectId().equals("p1")
                        && review.codeVersion().equals("commit-a") && review.ruleVersion().equals("rules-a")
                        && feedback.equals(review.historicalFeedback())));
    }

    @Test
    void list_filtersByProjectAndStatus() throws Exception {
        ReviewQueueEntry entry = new ReviewQueueEntry(
                "entry-1", "snap-1", "p1", "fp1", "rule-1", "",
                ExternalFindingSeverity.HIGH, TriageVerdict.TRUE_RISK, 0.7f,
                ReviewStatus.PENDING, "", "", "2026-07-28T00:00:00Z");
        when(reviewQueueStore.list(eq("p1"), eq(ExternalFindingSeverity.HIGH), isNull(),
                eq(ReviewStatus.PENDING), isNull(), isNull(), isNull(), eq(0), eq(100)))
                .thenReturn(List.of(entry));
        when(reviewQueueStore.count(eq("p1"), eq(ExternalFindingSeverity.HIGH), isNull(),
                eq(ReviewStatus.PENDING), isNull(), isNull(), isNull())).thenReturn(1);

        mvc.perform(get("/api/v1/review-queue")
                        .param("projectId", "p1")
                        .param("severity", "HIGH")
                        .param("status", "PENDING"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].id").value("entry-1"))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(100))
                .andExpect(jsonPath("$.total").value(1));
    }

    @Test
    void list_clampsPaginationBounds() throws Exception {
        when(reviewQueueStore.list(eq("p1"), isNull(), isNull(), isNull(),
                isNull(), isNull(), isNull(), eq(0), eq(500)))
                .thenReturn(List.of());
        when(reviewQueueStore.count(eq("p1"), isNull(), isNull(), isNull(),
                isNull(), isNull(), isNull())).thenReturn(0);

        mvc.perform(get("/api/v1/review-queue")
                        .param("projectId", "p1")
                        .param("page", "-3")
                        .param("size", "5000"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(500))
                .andExpect(jsonPath("$.total").value(0));
    }

    @Test
    void claim_returnsNotFoundWhenTransitionFails() throws Exception {
        when(reviewQueueStore.claim(eq("missing"), eq("alice"), any())).thenReturn(false);

        mvc.perform(post("/api/v1/review-queue/missing/claim")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"actor":"alice"}
                                """))
                .andExpect(status().isNotFound());
    }

    @Test
    void confirm_recordsActorAndReasonThenReturnsOk() throws Exception {
        when(reviewQueueStore.confirm(eq("entry-1"), eq("alice"), eq("verified"), any()))
                .thenReturn(true);

        mvc.perform(post("/api/v1/review-queue/entry-1/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"actor":"alice","reason":"verified"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CONFIRMED"));
    }

    @Test
    void audit_returnsStoredEvents() throws Exception {
        when(reviewQueueStore.audit("entry-1")).thenReturn(List.of(
                new ReviewQueueAuditEvent("a1", "entry-1", "SUBMITTED", "system", "", "2026-07-28T00:00:00Z")));

        mvc.perform(get("/api/v1/review-queue/entry-1/audit"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].action").value("SUBMITTED"));
    }

    @Test
    void export_returns404WhenSnapshotMissing() throws Exception {
        when(reviewQueueStore.getSnapshot("missing")).thenReturn(Optional.empty());

        mvc.perform(get("/api/v1/review-queue/snapshots/missing/export").param("format", "markdown"))
                .andExpect(status().isNotFound());
    }

    @Test
    void export_rejectsUnsupportedFormat() throws Exception {
        ReportSnapshot snapshot = new ReportSnapshot(
                "snap-1", "p1", "1", "0.5.0", "abc", "rules-1",
                "2026-07-28T00:00:00Z", List.of());
        when(reviewQueueStore.getSnapshot("snap-1")).thenReturn(Optional.of(snapshot));

        mvc.perform(get("/api/v1/review-queue/snapshots/snap-1/export").param("format", "docx"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("docx")));
    }

    @Test
    void export_rendersPdfFromSameSnapshotMarkdown() throws Exception {
        ReportSnapshot snapshot = new ReportSnapshot(
                "snap-1", "p1", "1", "0.5.0", "abc", "rules-1",
                "2026-07-28T00:00:00Z", List.of());
        when(reviewQueueStore.getSnapshot("snap-1")).thenReturn(Optional.of(snapshot));
        when(triageReportService.toMarkdownSummary(List.of())).thenReturn("## summary");
        when(reportPdfRenderer.render(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn("%PDF-1.4\n stub".getBytes(java.nio.charset.StandardCharsets.US_ASCII));

        mvc.perform(get("/api/v1/review-queue/snapshots/snap-1/export").param("format", "pdf"))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string("Content-Type", MediaType.APPLICATION_PDF_VALUE))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string("Content-Disposition",
                                org.hamcrest.Matchers.containsString("report-snap-1.pdf")));
    }

    @Test
    void exportBatch_returnsZipWithExportedSnapshotsAndManifest() throws Exception {
        ReportSnapshot snapshotOne = new ReportSnapshot(
                "snap-1", "p1", "1", "0.5.0", "abc", "rules-1",
                "2026-07-28T00:00:00Z", List.of());
        ReportSnapshot snapshotTwo = new ReportSnapshot(
                "snap-2", "p1", "1", "0.5.0", "abc", "rules-1",
                "2026-07-28T01:00:00Z", List.of());
        when(reviewQueueStore.getSnapshot("snap-1")).thenReturn(Optional.of(snapshotOne));
        when(reviewQueueStore.getSnapshot("snap-2")).thenReturn(Optional.of(snapshotTwo));
        when(triageReportService.toMarkdownSummary(List.of())).thenReturn("## summary");

        byte[] zipBytes = mvc.perform(post("/api/v1/review-queue/snapshots/export-batch")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"snapshotIds":["snap-1","snap-2"],"format":"markdown"}
                                """))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string("Content-Type", "application/zip"))
                .andReturn().getResponse().getContentAsByteArray();

        Map<String, byte[]> entries = zipEntries(zipBytes);
        assertThat(entries).containsKeys(
                "manifest.json", "snapshots/snap-1/report.md", "snapshots/snap-2/report.md");
        assertThat(new String(entries.get("snapshots/snap-1/report.md"),
                java.nio.charset.StandardCharsets.UTF_8)).contains("## summary");
        assertThat(new String(entries.get("manifest.json"),
                java.nio.charset.StandardCharsets.UTF_8))
                .contains("\"status\":\"exported\"")
                .doesNotContain("\"status\":\"missing\"");
    }

    @Test
    void exportBatch_partialMissing_recordsMissingInManifest() throws Exception {
        ReportSnapshot snapshot = new ReportSnapshot(
                "snap-1", "p1", "1", "0.5.0", "abc", "rules-1",
                "2026-07-28T00:00:00Z", List.of());
        when(reviewQueueStore.getSnapshot("snap-1")).thenReturn(Optional.of(snapshot));
        when(reviewQueueStore.getSnapshot("missing")).thenReturn(Optional.empty());
        when(triageReportService.toMarkdownSummary(List.of())).thenReturn("## summary");

        byte[] zipBytes = mvc.perform(post("/api/v1/review-queue/snapshots/export-batch")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"snapshotIds":["snap-1","missing"],"format":"markdown"}
                                """))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();

        Map<String, byte[]> entries = zipEntries(zipBytes);
        assertThat(entries).containsKey("snapshots/snap-1/report.md");
        assertThat(entries).doesNotContainKey("snapshots/missing/report.md");
        String manifest = new String(entries.get("manifest.json"),
                java.nio.charset.StandardCharsets.UTF_8);
        assertThat(manifest).contains("\"status\":\"missing\"").contains("missing");
        assertThat(manifest).contains("\"status\":\"exported\"");
    }

    @Test
    void exportBatch_whenAllMissing_returns404() throws Exception {
        when(reviewQueueStore.getSnapshot(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(Optional.empty());

        mvc.perform(post("/api/v1/review-queue/snapshots/export-batch")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"snapshotIds":["missing-1","missing-2"],"format":"markdown"}
                                """))
                .andExpect(status().isNotFound());
    }

    @Test
    void exportBatch_rejectsOversizedRequest() throws Exception {
        List<String> ids = new java.util.ArrayList<>();
        for (int i = 0; i < 101; i++) {
            ids.add("snap-" + i);
        }
        String body = "{\"snapshotIds\":" + ids.stream()
                .map(id -> "\"" + id + "\"").collect(java.util.stream.Collectors.joining(",", "[", "]"))
                + ",\"format\":\"markdown\"}";

        mvc.perform(post("/api/v1/review-queue/snapshots/export-batch")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void exportBatch_rendersPdfIntoZip() throws Exception {
        ReportSnapshot snapshot = new ReportSnapshot(
                "snap-1", "p1", "1", "0.5.0", "abc", "rules-1",
                "2026-07-28T00:00:00Z", List.of());
        when(reviewQueueStore.getSnapshot("snap-1")).thenReturn(Optional.of(snapshot));
        when(triageReportService.toMarkdownSummary(List.of())).thenReturn("## summary");
        when(reportPdfRenderer.render(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn("%PDF-1.4\n stub".getBytes(java.nio.charset.StandardCharsets.US_ASCII));

        byte[] zipBytes = mvc.perform(post("/api/v1/review-queue/snapshots/export-batch")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"snapshotIds":["snap-1"],"format":"pdf"}
                                """))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();

        Map<String, byte[]> entries = zipEntries(zipBytes);
        assertThat(entries.get("snapshots/snap-1/report.pdf"))
                .asString(java.nio.charset.StandardCharsets.US_ASCII).startsWith("%PDF");
    }

    private static Map<String, byte[]> zipEntries(byte[] zipBytes) throws Exception {
        Map<String, byte[]> entries = new java.util.LinkedHashMap<>();
        try (var zip = new java.util.zip.ZipInputStream(
                new java.io.ByteArrayInputStream(zipBytes))) {
            java.util.zip.ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                entries.put(entry.getName(), zip.readAllBytes());
            }
        }
        return entries;
    }

    @Test
    void export_marshalsMarkdownAndJsonFromSameSnapshot() throws Exception {
        ExternalFinding finding = finding();
        TriageReport report = new TriageReport(finding, true,
                "com.example.OrderService#run()", TriageVerdict.TRUE_RISK, 0.7f,
                List.of("报警定位到 [C1]"), List.of(), "使用 ProcessBuilder",
                "该报警大概率是真实风险", emptyPack());
        ReportSnapshot snapshot = new ReportSnapshot(
                "snap-1", "p1", "1", "0.5.0", "abc", "rules-1",
                "2026-07-28T00:00:00Z", List.of(report));
        when(reviewQueueStore.getSnapshot("snap-1")).thenReturn(Optional.of(snapshot));
        when(triageReportService.toMarkdownSummary(List.of(report))).thenReturn("## summary");

        mvc.perform(get("/api/v1/review-queue/snapshots/snap-1/export").param("format", "markdown"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/review-queue/snapshots/snap-1/export").param("format", "json"))
                .andExpect(status().isOk());
    }

    private static ContextPack emptyPack() {
        return new ContextPack("q", "security", List.of(), List.of(), 12000, 0, 1, 0, 0, 0);
    }

    private static ExternalFinding finding() {
        return new ExternalFinding("semgrep", "java.lang.security.audit.command-injection",
                "CWE-78", ExternalFindingSeverity.HIGH,
                "Detected command injection via Runtime.exec",
                "src/main/java/com/example/OrderService.java", 42, 42,
                "run", List.of(), "{}");
    }
}
