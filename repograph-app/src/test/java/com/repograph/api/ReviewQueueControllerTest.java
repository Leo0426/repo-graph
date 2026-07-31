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
import java.util.Optional;

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
        when(triageReportService.build(context)).thenReturn(report);
        when(buildProperties.getVersion()).thenReturn("0.5.0-test");
        when(reviewQueueStore.submit(any())).thenReturn(List.of(entry));

        mvc.perform(post("/api/v1/review-queue/snapshots")
                        .param("format", "semgrep")
                        .param("projectId", "p1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"results\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].id").value("entry-1"))
                .andExpect(jsonPath("$.entries[0].status").value("PENDING"));
    }

    @Test
    void list_filtersByProjectAndStatus() throws Exception {
        ReviewQueueEntry entry = new ReviewQueueEntry(
                "entry-1", "snap-1", "p1", "fp1", "rule-1", "",
                ExternalFindingSeverity.HIGH, TriageVerdict.TRUE_RISK, 0.7f,
                ReviewStatus.PENDING, "", "", "2026-07-28T00:00:00Z");
        when(reviewQueueStore.list(eq("p1"), eq(ExternalFindingSeverity.HIGH), isNull(),
                eq(ReviewStatus.PENDING), isNull(), isNull(), isNull()))
                .thenReturn(List.of(entry));

        mvc.perform(get("/api/v1/review-queue")
                        .param("projectId", "p1")
                        .param("severity", "HIGH")
                        .param("status", "PENDING"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("entry-1"));
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

        mvc.perform(get("/api/v1/review-queue/snapshots/snap-1/export").param("format", "pdf"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("pdf")));
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
