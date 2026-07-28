package com.repograph.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.advisory.LlmAdvisoryResult;
import com.repograph.core.advisory.LlmAdvisoryService;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
import com.repograph.core.retrieval.ContextPack;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

/**
 * LLM 辅助复核 API 测试。
 *
 * @author leolu
 */
class LlmAdvisoryControllerTest {

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
    private LlmAdvisoryService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(LlmAdvisoryService.class);
        mvc = standaloneSetup(new LlmAdvisoryController(service)).build();
    }

    @Test
    void review_returnsAdvisoryOnlyResultWithoutReplacingHeuristicVerdict() throws Exception {
        TriageReport report = report();
        when(service.review(any())).thenReturn(LlmAdvisoryResult.disabled(report));

        mvc.perform(post("/api/v1/triage/advisory")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(report)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DISABLED"))
                .andExpect(jsonPath("$.advisoryOnly").value(true))
                .andExpect(jsonPath("$.modelUsed").value(false))
                .andExpect(jsonPath("$.heuristicReport.verdict").value("TRUE_RISK"))
                .andExpect(jsonPath("$.suggestedVerdict").doesNotExist());
    }

    private static TriageReport report() {
        ExternalFinding finding = new ExternalFinding(
                "semgrep",
                "command-injection",
                "CWE-78",
                ExternalFindingSeverity.HIGH,
                "command injection",
                "src/Command.java",
                5,
                5,
                "run",
                List.of(),
                "");
        ContextPack pack = new ContextPack("q", "security", List.of(), List.of(), 100, 0, 0, 0, 0, 0);
        return new TriageReport(
                finding,
                true,
                "Command.run",
                TriageVerdict.TRUE_RISK,
                0.8f,
                List.of(),
                List.of(),
                "fix",
                "summary",
                pack);
    }
}
