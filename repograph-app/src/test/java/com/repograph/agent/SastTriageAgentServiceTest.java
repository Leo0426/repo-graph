package com.repograph.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.advisory.LlmAdvisoryResult;
import com.repograph.core.advisory.LlmAdvisoryService;
import com.repograph.core.advisory.LlmAdvisoryStatus;
import com.repograph.core.advisory.LlmUsage;
import com.repograph.core.agent.AgentRun;
import com.repograph.core.agent.AgentRunStatus;
import com.repograph.core.agent.AgentStepStatus;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
import com.repograph.core.retrieval.ContextPack;
import com.repograph.finding.ExternalFindingImporter;
import com.repograph.finding.FindingContextService;
import com.repograph.finding.ReviewQueueStore;
import com.repograph.finding.RuleSuppressionStore;
import com.repograph.finding.TriageFeedbackStore;
import com.repograph.finding.TriageReportService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.info.BuildProperties;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@link SastTriageAgentService} 可观察工作流行为测试。
 *
 * @author leolu
 */
class SastTriageAgentServiceTest {

    @TempDir
    Path tempDir;

    private AgentRunStore runStore;
    private ReviewQueueStore reviewQueueStore;
    private ExternalFindingImporter importer;
    private FindingContextService contextService;
    private TriageReportService reportService;
    private LlmAdvisoryService advisoryService;
    private SastTriageAgentService service;

    @BeforeEach
    void setUp() {
        String dbPath = tempDir.resolve("agent.db").toString();
        runStore = new AgentRunStore(dbPath);
        reviewQueueStore = new ReviewQueueStore(dbPath, new ObjectMapper());
        importer = mock(ExternalFindingImporter.class);
        contextService = mock(FindingContextService.class);
        reportService = mock(TriageReportService.class);
        advisoryService = mock(LlmAdvisoryService.class);
        when(importer.supports("semgrep")).thenReturn(true);

        Properties properties = new Properties();
        properties.setProperty("version", "0.5.0-test");
        BuildProperties buildProperties = new BuildProperties(properties);
        service = new SastTriageAgentService(
                List.of(importer), contextService, reportService,
                mock(TriageFeedbackStore.class), mock(RuleSuppressionStore.class),
                advisoryService, reviewQueueStore, runStore, buildProperties,
                Runnable::run,
                Clock.fixed(Instant.parse("2026-08-09T03:00:00Z"), ZoneOffset.UTC));
    }

    @Test
    void executeCreatesAuditableTimelineAndHandsReportsToHumanReview() {
        ExternalFinding finding = finding();
        ContextPack pack = new ContextPack("query", "security", List.of(),
                List.of("trace unavailable"), 12000, 0, 0, 0, 0, 0);
        FindingContext context = new FindingContext(finding, false, "", pack);
        TriageReport report = new TriageReport(
                finding, false, "", TriageVerdict.NEEDS_REVIEW, 0.2f,
                List.of("报警位置未被索引"), List.of("缺少代码上下文"),
                "补充索引", "需要人工复核", pack);
        when(importer.importJson(any(java.io.InputStream.class), anyInt())).thenReturn(List.of(finding));
        when(contextService.build(any(), any())).thenReturn(context);
        when(reportService.build(any(), any())).thenReturn(report);
        when(advisoryService.review(report)).thenReturn(LlmAdvisoryResult.disabled(report));

        AgentRun accepted = service.start(new SastTriageAgentCommand(
                "project-1", "semgrep", "{\"results\":[]}", "abc123", "rules-v1", 12000, 10));

        AgentRun completed = runStore.get(accepted.id()).orElseThrow();
        assertThat(completed.status()).isEqualTo(AgentRunStatus.WAITING_FOR_REVIEW);
        assertThat(completed.outputReference()).startsWith("report-snapshot:");
        assertThat(completed.steps()).extracting(step -> step.capability())
                .containsExactly("IMPORT_FINDINGS", "BUILD_CONTEXT", "TRIAGE_FINDINGS",
                        "LLM_ADVISORY", "SUBMIT_REVIEW");
        assertThat(completed.steps()).extracting(step -> step.status())
                .containsExactly(AgentStepStatus.COMPLETED, AgentStepStatus.COMPLETED,
                        AgentStepStatus.COMPLETED, AgentStepStatus.SKIPPED, AgentStepStatus.COMPLETED);
        assertThat(completed.steps().get(0).evidenceReferences())
                .containsExactly("finding:" + finding.fingerprint());
        assertThat(completed.steps().get(1).missingInfo()).contains("trace unavailable");
        String snapshotId = completed.outputReference().substring("report-snapshot:".length());
        assertThat(reviewQueueStore.getSnapshot(snapshotId)).isPresent();
    }

    @Test
    void completedLlmReviewExposesAdvisoryDecisionWithoutReplacingHeuristicVerdict() {
        ExternalFinding finding = finding();
        ContextPack pack = new ContextPack("query", "security", List.of(),
                List.of(), 12000, 0, 0, 0, 0, 0);
        FindingContext context = new FindingContext(finding, true, "unit-1", pack);
        TriageReport report = new TriageReport(
                finding, true, "unit-1", TriageVerdict.NEEDS_REVIEW, 0.6f,
                List.of("存在危险调用"), List.of(), "人工确认参数来源", "需要人工复核", pack);
        when(importer.importJson(any(java.io.InputStream.class), anyInt())).thenReturn(List.of(finding));
        when(contextService.build(any(), any())).thenReturn(context);
        when(reportService.build(any(), any())).thenReturn(report);
        when(advisoryService.review(report)).thenReturn(new LlmAdvisoryResult(
                report, LlmAdvisoryStatus.COMPLETED, true, true,
                "OLLAMA", "qwen3:8b", TriageVerdict.TRUE_RISK, 0.15f,
                List.of(), List.of(), 0, 1, 25L, LlmUsage.NONE));

        AgentRun accepted = service.start(new SastTriageAgentCommand(
                "project-1", "semgrep", "{\"results\":[]}", "abc123", "rules-v1", 12000, 10));

        AgentRun completed = runStore.get(accepted.id()).orElseThrow();
        assertThat(completed.steps()).filteredOn(step -> step.capability().equals("LLM_ADVISORY"))
                .singleElement().satisfies(step -> {
                    assertThat(step.results()).singleElement().satisfies(result -> {
                        assertThat(result.subjectReference()).isEqualTo("finding:" + finding.fingerprint());
                        assertThat(result.baseline()).isEqualTo("NEEDS_REVIEW");
                        assertThat(result.recommendation()).isEqualTo("TRUE_RISK");
                        assertThat(result.uncertainty()).isEqualTo(0.15f);
                        assertThat(result.advisoryOnly()).isTrue();
                    });
                });
        assertThat(reviewQueueStore.getSnapshot(
                completed.outputReference().substring("report-snapshot:".length())))
                .get().satisfies(snapshot -> assertThat(snapshot.reports().get(0).verdict())
                        .isEqualTo(TriageVerdict.NEEDS_REVIEW));
    }

    @Test
    void invalidInputLeavesFailedRunInsteadOfLosingExecutionHistory() {
        when(importer.importJson(any(java.io.InputStream.class), anyInt()))
                .thenThrow(new IllegalArgumentException("malformed JSON"));

        AgentRun accepted = service.start(new SastTriageAgentCommand(
                "project-1", "semgrep", "not-json", "", "", 12000, 10));

        AgentRun failed = runStore.get(accepted.id()).orElseThrow();
        assertThat(failed.status()).isEqualTo(AgentRunStatus.FAILED);
        assertThat(failed.statusReason()).contains("IMPORT_FAILED").contains("malformed JSON");
        assertThat(failed.steps()).singleElement().satisfies(step -> {
            assertThat(step.capability()).isEqualTo("IMPORT_FINDINGS");
            assertThat(step.status()).isEqualTo(AgentStepStatus.FAILED);
            assertThat(step.error()).contains("malformed JSON");
        });
    }

    @Test
    void failureAfterProducingEvidenceMarksRunPartialAndKeepsCompletedSteps() {
        ExternalFinding finding = finding();
        when(importer.importJson(any(java.io.InputStream.class), anyInt())).thenReturn(List.of(finding));
        when(contextService.build(any(), any())).thenThrow(new IllegalStateException("graph unavailable"));

        AgentRun accepted = service.start(new SastTriageAgentCommand(
                "project-1", "semgrep", "{\"results\":[]}", "", "", 12000, 10));

        AgentRun partial = runStore.get(accepted.id()).orElseThrow();
        assertThat(partial.status()).isEqualTo(AgentRunStatus.PARTIAL);
        assertThat(partial.statusReason()).contains("CONTEXT_FAILED").contains("graph unavailable");
        assertThat(partial.steps()).extracting(step -> step.status())
                .containsExactly(AgentStepStatus.COMPLETED, AgentStepStatus.FAILED);
        assertThat(partial.steps().get(0).evidenceReferences())
                .containsExactly("finding:" + finding.fingerprint());
    }

    private static ExternalFinding finding() {
        return new ExternalFinding(
                "semgrep", "java.lang.security.audit.command-injection", "CWE-78",
                ExternalFindingSeverity.HIGH, "command injection", "src/Command.java",
                12, 12, "run", List.of(), "");
    }
}
