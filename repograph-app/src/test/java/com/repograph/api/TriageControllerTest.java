package com.repograph.api;

import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.finding.TriageFeedback;
import com.repograph.core.finding.TriageFeedbackStatus;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageReviewContext;
import com.repograph.core.finding.TriageVerdict;
import com.repograph.core.retrieval.ContextPack;
import com.repograph.finding.ExternalFindingImportException;
import com.repograph.finding.ExternalFindingImporter;
import com.repograph.finding.FindingContextService;
import com.repograph.finding.RuleSuppressionStore;
import com.repograph.finding.TriageFeedbackStore;
import com.repograph.finding.TriageReportService;
import com.repograph.finding.github.GitHubCommentException;
import com.repograph.finding.github.GitHubPrCommentClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link TriageController} REST 契约测试。
 *
 * @author leolu
 */
@WebMvcTest(TriageController.class)
class TriageControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    ExternalFindingImporter importer;

    @MockitoBean
    FindingContextService findingContextService;

    @MockitoBean
    TriageReportService triageReportService;

    @MockitoBean
    TriageFeedbackStore feedbackStore;

    @MockitoBean
    RuleSuppressionStore ruleSuppressionStore;

    @MockitoBean
    GitHubPrCommentClient gitHubPrCommentClient;

    @Test
    void report_generatesReportPerFinding() throws Exception {
        ExternalFinding finding = finding();
        FindingContext context = new FindingContext(finding, true,
                "com.example.OrderService#run()", emptyPack());
        TriageReport report = new TriageReport(finding, true,
                "com.example.OrderService#run()", TriageVerdict.TRUE_RISK, 0.7f,
                List.of("报警定位到 [C1]"), List.of(), "使用 ProcessBuilder",
                "该报警大概率是真实风险", emptyPack());

        when(importer.supports("semgrep")).thenReturn(true);
        when(importer.importJson(any(java.io.InputStream.class), eq(10))).thenReturn(List.of(finding));
        when(findingContextService.build(eq(finding), any())).thenReturn(context);
        when(triageReportService.build(context)).thenReturn(report);
        when(triageReportService.toMarkdown(report)).thenReturn("## report");

        mvc.perform(post("/api/v1/triage/report")
                        .param("format", "semgrep")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"results\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].fingerprint").value(finding.fingerprint()))
                .andExpect(jsonPath("$[0].report.verdict").value("TRUE_RISK"))
                .andExpect(jsonPath("$[0].markdown").value("## report"));
    }

    @Test
    void report_loadsProjectScopedFeedbackWhenVersionsAreProvided() throws Exception {
        ExternalFinding finding = finding();
        FindingContext context = new FindingContext(finding, true,
                "com.example.OrderService#run()", emptyPack());
        TriageFeedback feedback = new TriageFeedback(
                finding.fingerprint(), "p1", TriageFeedbackStatus.FALSE_POSITIVE,
                "leo", "fixed enum", "commit-a", "rules-2", "2026-07-26T12:00:00Z");
        TriageReviewContext reviewContext = new TriageReviewContext(
                "p1", "commit-a", "rules-2", feedback);
        TriageReport report = new TriageReport(finding, true,
                "com.example.OrderService#run()", TriageVerdict.LIKELY_FALSE_POSITIVE, 0.9f,
                List.of("历史反馈"), List.of(), "review", "history", emptyPack());

        when(importer.supports("semgrep")).thenReturn(true);
        when(importer.importJson(any(java.io.InputStream.class), eq(10))).thenReturn(List.of(finding));
        when(findingContextService.build(eq(finding), any())).thenReturn(context);
        when(feedbackStore.findByFingerprint("p1", finding.fingerprint()))
                .thenReturn(java.util.Optional.of(feedback));
        when(triageReportService.build(context, reviewContext)).thenReturn(report);
        when(triageReportService.toMarkdown(report)).thenReturn("## history");

        mvc.perform(post("/api/v1/triage/report")
                        .param("format", "semgrep")
                        .param("projectId", "p1")
                        .param("codeVersion", "commit-a")
                        .param("ruleVersion", "rules-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"results\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].report.verdict").value("LIKELY_FALSE_POSITIVE"));

        verify(feedbackStore).findByFingerprint("p1", finding.fingerprint());
        verify(triageReportService).build(context, reviewContext);
    }

    @Test
    void report_rejectsUnsupportedFormat() throws Exception {
        when(importer.supports("fortify")).thenReturn(false);

        mvc.perform(post("/api/v1/triage/report")
                        .param("format", "fortify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(
                        org.hamcrest.Matchers.containsString("fortify")));
    }

    @Test
    void report_rejectsInvalidJsonWith400() throws Exception {
        when(importer.supports("semgrep")).thenReturn(true);
        when(importer.importJson(any(java.io.InputStream.class), eq(10)))
                .thenThrow(new ExternalFindingImportException("invalid semgrep JSON"));

        mvc.perform(post("/api/v1/triage/report")
                        .param("format", "semgrep")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("not-json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid semgrep JSON"));
    }

    @Test
    void reportToPr_postsCombinedMarkdownAndReturnsCommentUrl() throws Exception {
        ExternalFinding finding = finding();
        FindingContext context = new FindingContext(finding, true,
                "com.example.OrderService#run()", emptyPack());
        TriageReport report = new TriageReport(finding, true,
                "com.example.OrderService#run()", TriageVerdict.TRUE_RISK, 0.7f,
                List.of("报警定位到 [C1]"), List.of(), "使用 ProcessBuilder",
                "该报警大概率是真实风险", emptyPack());

        when(importer.supports("semgrep")).thenReturn(true);
        when(importer.importJson(any(java.io.InputStream.class), eq(10))).thenReturn(List.of(finding));
        when(findingContextService.build(eq(finding), any())).thenReturn(context);
        when(triageReportService.build(context)).thenReturn(report);
        when(triageReportService.toMarkdown(report)).thenReturn("## report");
        when(triageReportService.toMarkdownSummary(List.of(report))).thenReturn("## summary");
        when(gitHubPrCommentClient.postComment("leo", "demo", 42, "## summary"))
                .thenReturn("https://github.com/leo/demo/pull/42#issuecomment-1");

        mvc.perform(post("/api/v1/triage/report/pr")
                        .param("format", "semgrep")
                        .param("owner", "leo")
                        .param("repo", "demo")
                        .param("prNumber", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"results\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentUrl").value("https://github.com/leo/demo/pull/42#issuecomment-1"))
                .andExpect(jsonPath("$.findingsCount").value(1))
                .andExpect(jsonPath("$.reports[0].fingerprint").value(finding.fingerprint()));

        verify(gitHubPrCommentClient).postComment("leo", "demo", 42, "## summary");
    }

    @Test
    void reportToPr_returns502WhenGitHubCommentFails() throws Exception {
        ExternalFinding finding = finding();
        FindingContext context = new FindingContext(finding, true,
                "com.example.OrderService#run()", emptyPack());
        TriageReport report = new TriageReport(finding, true,
                "com.example.OrderService#run()", TriageVerdict.TRUE_RISK, 0.7f,
                List.of(), List.of(), "", "", emptyPack());

        when(importer.supports("semgrep")).thenReturn(true);
        when(importer.importJson(any(java.io.InputStream.class), eq(10))).thenReturn(List.of(finding));
        when(findingContextService.build(eq(finding), any())).thenReturn(context);
        when(triageReportService.build(context)).thenReturn(report);
        when(triageReportService.toMarkdownSummary(any())).thenReturn("## summary");
        when(gitHubPrCommentClient.postComment(any(), any(), anyInt(), any()))
                .thenThrow(new GitHubCommentException("GitHub token not configured"));

        mvc.perform(post("/api/v1/triage/report/pr")
                        .param("format", "semgrep")
                        .param("owner", "leo")
                        .param("repo", "demo")
                        .param("prNumber", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"results\":[]}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error").value("GitHub token not configured"));
    }

    @Test
    void feedback_upsertsAndReturnsRecord() throws Exception {
        mvc.perform(post("/api/v1/triage/feedback")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"fingerprint":"fp-1","projectId":"p1",
                                 "status":"false_positive","reviewer":"leo","reason":"有校验"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FALSE_POSITIVE"))
                .andExpect(jsonPath("$.updatedAt").isNotEmpty());

        verify(feedbackStore).upsert(any(TriageFeedback.class));
    }

    @Test
    void feedback_rejectsInvalidStatus() throws Exception {
        mvc.perform(post("/api/v1/triage/feedback")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"fingerprint":"fp-1","projectId":"p1","status":"WONT_FIX"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(
                        org.hamcrest.Matchers.containsString("WONT_FIX")));
    }

    @Test
    void listFeedback_filtersByStatus() throws Exception {
        when(feedbackStore.list("p1", TriageFeedbackStatus.TRUE_POSITIVE))
                .thenReturn(List.of(new TriageFeedback("fp-1", "p1",
                        TriageFeedbackStatus.TRUE_POSITIVE, "leo", "", "2026-07-10T12:00:00Z")));

        mvc.perform(get("/api/v1/triage/feedback")
                        .param("projectId", "p1")
                        .param("status", "TRUE_POSITIVE"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].fingerprint").value("fp-1"));
    }

    @Test
    void suppressionApiRequiresScopeReasonCreatorAndExpiry() throws Exception {
        mvc.perform(post("/api/v1/triage/suppressions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "projectId":"p1",
                                  "ruleId":"java.command-injection",
                                  "scope":"FILE_GLOB",
                                  "scopeValue":"src/test/**",
                                  "reason":"training fixtures",
                                  "createdBy":"leo",
                                  "expiresAt":"2027-01-01T00:00:00Z"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").value("p1"))
                .andExpect(jsonPath("$.scope").value("FILE_GLOB"))
                .andExpect(jsonPath("$.reason").value("training fixtures"))
                .andExpect(jsonPath("$.createdBy").value("leo"))
                .andExpect(jsonPath("$.expiresAt").value("2027-01-01T00:00:00Z"))
                .andExpect(jsonPath("$.active").value(true));

        verify(ruleSuppressionStore).create(any());
    }

    @Test
    void suppressionRevokeReturnsNotFoundOrRevoked() throws Exception {
        when(ruleSuppressionStore.revoke(eq("suppression-1"), eq("leo"), eq("obsolete"), any()))
                .thenReturn(true);

        mvc.perform(post("/api/v1/triage/suppressions/suppression-1/revoke")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"actor":"leo","reason":"obsolete"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REVOKED"));

        mvc.perform(post("/api/v1/triage/suppressions/missing/revoke")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"actor":"leo","reason":"obsolete"}
                                """))
                .andExpect(status().isNotFound());
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
