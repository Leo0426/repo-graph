package com.repograph.finding;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.DetectionRule;
import com.repograph.core.finding.DetectionRuleDraft;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.ExternalFindingTraceStep;
import com.repograph.core.finding.ReportSnapshot;
import com.repograph.core.finding.RuleEvaluationReport;
import com.repograph.core.finding.RuleMatcherKind;
import com.repograph.core.finding.RuleMetricDelta;
import com.repograph.core.finding.RuleNotFoundException;
import com.repograph.core.finding.RuleStatus;
import com.repograph.core.finding.RuleSuppression;
import com.repograph.core.finding.RuleSuppressionScope;
import com.repograph.core.finding.TriageFeedback;
import com.repograph.core.finding.TriageFeedbackStatus;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link RuleEffectEvaluationService} 的端到端装配测试：真实 SQLite store +
 * 纯函数评估器，覆盖快照装配、无上下文信号、回归链、无 active 回退与 404 语义。
 *
 * @author leolu
 */
class RuleEffectEvaluationServiceTest {

    private static final String RULE_ID = "java.command-injection";
    private static final String PROJECT_ID = "proj-1";

    @TempDir
    Path tempDir;

    private RuleRegistryStore registry;
    private TriageFeedbackStore feedbackStore;
    private RuleSuppressionStore suppressionStore;
    private ReviewQueueStore reviewQueueStore;
    private RuleEvaluationStore evaluationStore;
    private RuleEffectEvaluationService service;

    @BeforeEach
    void setUp() {
        String dbPath = tempDir.resolve("index.db").toString();
        ObjectMapper objectMapper = new ObjectMapper();
        registry = new RuleRegistryStore(dbPath);
        feedbackStore = new TriageFeedbackStore(dbPath);
        suppressionStore = new RuleSuppressionStore(dbPath);
        reviewQueueStore = new ReviewQueueStore(dbPath, objectMapper);
        evaluationStore = new RuleEvaluationStore(dbPath, objectMapper);
        service = new RuleEffectEvaluationService(
                registry, reviewQueueStore, feedbackStore, suppressionStore,
                new DefaultRuleEffectEvaluator(), evaluationStore);
    }

    @Test
    void evaluate_assemblesFactsFromRealStores_andPersistsSnapshot() {
        publishRule();
        ExternalFinding findingOne = finding("src/Main.java");
        ExternalFinding findingTwo = finding("src/util/Cmd.java");
        submitSnapshot("snap-1", "2026-10-13T08:00:00Z",
                report(findingOne, true), report(findingTwo, false));
        feedbackStore.upsert(feedback(findingOne, TriageFeedbackStatus.TRUE_POSITIVE, "alice"));
        feedbackStore.upsert(feedback(findingTwo, TriageFeedbackStatus.FALSE_POSITIVE, "alice"));
        suppressionStore.create(suppression("sup-1", "src/util/*",
                "2026-10-01T00:00:00Z", "2027-01-01T00:00:00Z"));

        RuleEvaluationReport report = service.evaluate(RULE_ID, PROJECT_ID);

        assertThat(report.ruleId()).isEqualTo(RULE_ID);
        assertThat(report.version()).isEqualTo(1);
        assertThat(report.metrics().hits()).isEqualTo(2);
        assertThat(report.metrics().confirmed()).isEqualTo(1);
        assertThat(report.metrics().falsePositives()).isEqualTo(1);
        assertThat(report.metrics().confirmationRate()).isEqualTo(0.5);
        assertThat(report.metrics().falsePositiveRate()).isEqualTo(0.5);
        // 仅 fp-2 位于 src/util/*，被 FILE_GLOB 抑制
        assertThat(report.metrics().suppressionRate()).isEqualTo(0.5);
        // fp-2 的研判报告 located=false
        assertThat(report.metrics().noContextRate()).isEqualTo(0.5);
        assertThat(report.regression()).isEmpty();
        assertThat(report.omittedReasons()).isEmpty();
        assertThat(evaluationStore.list(PROJECT_ID, RULE_ID)).hasSize(1);
    }

    @Test
    void evaluate_twiceWithChangedFeedback_producesRegressionChain() {
        publishRule();
        ExternalFinding findingOne = finding("src/Main.java");
        ExternalFinding findingTwo = finding("src/util/Cmd.java");
        submitSnapshot("snap-1", "2026-10-13T08:00:00Z",
                report(findingOne, true), report(findingTwo, true));
        feedbackStore.upsert(feedback(findingOne, TriageFeedbackStatus.TRUE_POSITIVE, "alice"));
        feedbackStore.upsert(feedback(findingTwo, TriageFeedbackStatus.FALSE_POSITIVE, "alice"));
        service.evaluate(RULE_ID, PROJECT_ID);

        feedbackStore.upsert(feedback(findingTwo, TriageFeedbackStatus.TRUE_POSITIVE, "bob"));
        RuleEvaluationReport second = service.evaluate(RULE_ID, PROJECT_ID);

        assertThat(second.metrics().confirmed()).isEqualTo(2);
        assertThat(second.metrics().confirmationRate()).isEqualTo(1.0);
        assertThat(findDelta(second, "confirmationRate").previous()).isEqualTo(0.5);
        assertThat(findDelta(second, "confirmationRate").current()).isEqualTo(1.0);
        List<RuleEvaluationReport> history = service.history(RULE_ID, PROJECT_ID);
        assertThat(history).hasSize(2);
        assertThat(history.get(0).generatedAt()).isEqualTo(second.generatedAt());
    }

    @Test
    void evaluate_withZeroHits_returnsEmptyMetricsWithOmittedReason() {
        publishRule();

        RuleEvaluationReport report = service.evaluate(RULE_ID, PROJECT_ID);

        assertThat(report.metrics().hits()).isZero();
        assertThat(report.metrics().confirmationRate()).isNull();
        assertThat(report.omittedReasons()).anyMatch(reason -> reason.contains("无命中"));
        assertThat(evaluationStore.list(PROJECT_ID, RULE_ID)).hasSize(1);
    }

    @Test
    void evaluate_unknownRule_throwsRuleNotFound() {
        assertThatThrownBy(() -> service.evaluate("missing.rule", PROJECT_ID))
                .isInstanceOf(RuleNotFoundException.class);
    }

    // 说明:"无 active 版本回退"分支为防御性逻辑——当前生命周期下(v1 回滚无前序会抛
    // RuleTransitionException),公共 API 无法构造出"存在版本但无 active"的状态,无法直接测试。

    private RuleMetricDelta findDelta(RuleEvaluationReport report, String metric) {
        return report.regression().stream()
                .filter(delta -> delta.metric().equals(metric))
                .findFirst().orElseThrow();
    }

    private void publishRule() {
        DetectionRuleDraft draft = new DetectionRuleDraft(
                RULE_ID, "internal-security-team", List.of("java"), List.of("spring"),
                "CWE-78", ExternalFindingSeverity.HIGH, "Runtime command injection",
                RuleMatcherKind.REGEX, "Runtime\\.getRuntime\\(\\)\\.exec",
                List.of("Runtime.getRuntime().exec(input);"),
                List.of("safeExecutor.run(validatedConstant);"), "initial version");
        DetectionRule candidate = registry.createCandidate(draft, "alice", "candidate",
                "2026-10-13T07:00:00Z");
        registry.submitForReview(candidate.ruleId(), candidate.version(), "bob", "review",
                "2026-10-13T07:01:00Z");
        registry.publish(candidate.ruleId(), candidate.version(), "carol", "publish",
                "2026-10-13T07:02:00Z");
    }

    private void submitSnapshot(String snapshotId, String generatedAt, TriageReport... reports) {
        ReportSnapshot snapshot = new ReportSnapshot(
                snapshotId, PROJECT_ID, "1", "test", "", "", generatedAt, List.of(reports));
        reviewQueueStore.submit(snapshot);
    }

    private ExternalFinding finding(String filePath) {
        return new ExternalFinding(
                "semgrep", RULE_ID, "CWE-78", ExternalFindingSeverity.HIGH,
                "command injection risk", filePath, 10, 20, "run",
                List.<ExternalFindingTraceStep>of(), "");
    }

    private TriageReport report(ExternalFinding finding, boolean located) {
        return new TriageReport(
                finding, located, located ? "com.demo.Run#run" : "",
                TriageVerdict.TRUE_RISK, 0.6f, List.of(), List.of(), "", "", null, List.of());
    }

    private TriageFeedback feedback(
            ExternalFinding finding, TriageFeedbackStatus status, String reviewer) {
        return new TriageFeedback(
                finding.fingerprint(), PROJECT_ID, status, reviewer, "reason",
                "2026-10-13T08:05:00Z");
    }

    private RuleSuppression suppression(
            String id, String glob, String createdAt, String expiresAt) {
        return new RuleSuppression(
                id, PROJECT_ID, RULE_ID, RuleSuppressionScope.FILE_GLOB, glob,
                "known fp cluster", "alice", createdAt, expiresAt, true);
    }
}
