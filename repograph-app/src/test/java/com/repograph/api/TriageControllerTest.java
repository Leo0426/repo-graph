package com.repograph.api;

import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.finding.TriageFeedback;
import com.repograph.core.finding.TriageFeedbackStatus;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
import com.repograph.core.retrieval.ContextPack;
import com.repograph.finding.ExternalFindingImportException;
import com.repograph.finding.ExternalFindingImporter;
import com.repograph.finding.FindingContextService;
import com.repograph.finding.TriageFeedbackStore;
import com.repograph.finding.TriageReportService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.any;
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
