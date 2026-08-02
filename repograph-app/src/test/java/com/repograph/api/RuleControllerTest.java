package com.repograph.api;

import com.repograph.core.finding.DetectionRule;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.RuleAuditEvent;
import com.repograph.core.finding.RuleMatcherKind;
import com.repograph.core.finding.RuleRegistry;
import com.repograph.core.finding.RuleStatus;
import com.repograph.core.finding.RuleTransitionException;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link RuleController} REST 契约测试。
 *
 * @author leolu
 */
@WebMvcTest(RuleController.class)
class RuleControllerTest {

    @org.springframework.beans.factory.annotation.Autowired
    MockMvc mvc;

    @MockitoBean
    RuleRegistry registry;

    @Test
    void createCandidate_returnsAssignedVersionAndCandidateStatus() throws Exception {
        when(registry.createCandidate(any(), eq("alice"), eq("initial"), any()))
                .thenReturn(rule(1, RuleStatus.CANDIDATE, false));

        mvc.perform(post("/api/v1/rules")
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "ruleId":"java.command-injection",
                                  "source":"internal",
                                  "languages":["java"],
                                  "frameworks":["spring"],
                                  "cwe":"CWE-78",
                                  "severity":"HIGH",
                                  "title":"Command injection",
                                  "matcherKind":"REGEX",
                                  "pattern":"Runtime.*exec",
                                  "positiveSamples":["Runtime.getRuntime().exec(input)"],
                                  "negativeSamples":["new ProcessBuilder(cmd)"],
                                  "changeNotes":"initial",
                                  "actor":"alice",
                                  "reason":"initial"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.status").value("CANDIDATE"));
    }

    @Test
    void lifecycleEndpoints_returnObservableStates() throws Exception {
        when(registry.submitForReview(eq("java.command-injection"), eq(1), eq("bob"), eq("review"), any()))
                .thenReturn(rule(1, RuleStatus.IN_REVIEW, false));
        when(registry.publish(eq("java.command-injection"), eq(1), eq("carol"), eq("approved"), any()))
                .thenReturn(rule(1, RuleStatus.PUBLISHED, true));
        when(registry.rollback(eq("java.command-injection"), eq("dana"), eq("regression"), any()))
                .thenReturn(rule(1, RuleStatus.PUBLISHED, true));

        mvc.perform(post("/api/v1/rules/java.command-injection/versions/1/review")
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{\"actor\":\"bob\",\"reason\":\"review\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_REVIEW"));
        mvc.perform(post("/api/v1/rules/java.command-injection/versions/1/publish")
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{\"actor\":\"carol\",\"reason\":\"approved\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(true));
        mvc.perform(post("/api/v1/rules/java.command-injection/rollback")
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{\"actor\":\"dana\",\"reason\":\"regression\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
    }

    @Test
    void listAndAudit_returnVersionHistory() throws Exception {
        when(registry.list("java.command-injection")).thenReturn(List.of(rule(1, RuleStatus.PUBLISHED, true)));
        when(registry.find("java.command-injection", 1))
                .thenReturn(Optional.of(rule(1, RuleStatus.PUBLISHED, true)));
        when(registry.audit("java.command-injection")).thenReturn(List.of(
                new RuleAuditEvent("a1", "java.command-injection", 1,
                        "PUBLISHED", "carol", "approved", "2026-08-01T10:00:00Z")));

        mvc.perform(get("/api/v1/rules").param("ruleId", "java.command-injection"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].version").value(1));
        mvc.perform(get("/api/v1/rules/java.command-injection/versions/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"));
        mvc.perform(get("/api/v1/rules/java.command-injection/audit"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].action").value("PUBLISHED"));
    }

    @Test
    void publish_whenRegressionGateRejects_returnsConflict() throws Exception {
        when(registry.publish(eq("java.command-injection"), eq(1), eq("carol"), eq("approved"), any()))
                .thenThrow(new RuleTransitionException("Regression gate rejected rule"));

        mvc.perform(post("/api/v1/rules/java.command-injection/versions/1/publish")
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{\"actor\":\"carol\",\"reason\":\"approved\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RULE_TRANSITION_REJECTED"));
    }

    private static DetectionRule rule(int version, RuleStatus status, boolean active) {
        return new DetectionRule(
                "java.command-injection", version, "internal", List.of("java"), List.of("spring"),
                "CWE-78", ExternalFindingSeverity.HIGH, "Command injection", RuleMatcherKind.REGEX,
                "Runtime.*exec", status, List.of("Runtime.getRuntime().exec(input)"),
                List.of("new ProcessBuilder(cmd)"), "initial", active,
                "2026-08-01T10:00:00Z", "2026-08-01T10:00:00Z");
    }
}
