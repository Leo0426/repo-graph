package com.repograph.finding;

import com.repograph.core.finding.RuleEvaluationHit;
import com.repograph.core.finding.RuleEvaluationReport;
import com.repograph.core.finding.RuleEvaluationRequest;
import com.repograph.core.finding.RuleMetricDelta;
import com.repograph.core.finding.RuleMetricSet;
import com.repograph.core.finding.RuleSuppression;
import com.repograph.core.finding.RuleSuppressionScope;
import com.repograph.core.finding.TriageFeedbackStatus;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link DefaultRuleEffectEvaluator} 的纯函数指标计算与版本回归测试。
 *
 * @author leolu
 */
class DefaultRuleEffectEvaluatorTest {

    private final DefaultRuleEffectEvaluator evaluator = new DefaultRuleEffectEvaluator();

    @Test
    void evaluate_withMixedFeedback_computesSixMetrics() {
        RuleEvaluationRequest request = new RuleEvaluationRequest(
                "java.command.injection", 2, "proj-1",
                List.of(
                        new RuleEvaluationHit("fp-1", "src/Main.java"),
                        new RuleEvaluationHit("fp-2", "src/util/Cmd.java"),
                        new RuleEvaluationHit("fp-3", "src/util/Exec.java"),
                        new RuleEvaluationHit("fp-4", "src/util/Run.java"),
                        new RuleEvaluationHit("fp-5", "src/util/Other.java")),
                Map.of(
                        "fp-1", TriageFeedbackStatus.TRUE_POSITIVE,
                        "fp-2", TriageFeedbackStatus.FIXED,
                        "fp-3", TriageFeedbackStatus.FALSE_POSITIVE,
                        "fp-4", TriageFeedbackStatus.NEEDS_REVIEW),
                List.of(projectSuppression("sup-1"), globSuppression("sup-2", "src/util/*"),
                        expiredSuppression("sup-3"), inactiveSuppression("sup-4"),
                        otherRuleSuppression("sup-5")),
                Set.of("fp-1", "fp-9"),
                null,
                "2026-10-12T08:00:00Z");

        RuleEvaluationReport report = evaluator.evaluate(request);

        RuleMetricSet metrics = report.metrics();
        assertThat(metrics.hits()).isEqualTo(5);
        assertThat(metrics.confirmed()).isEqualTo(2);
        assertThat(metrics.falsePositives()).isEqualTo(1);
        assertThat(metrics.needsReview()).isEqualTo(1);
        assertThat(metrics.confirmationRate()).isEqualTo(2.0 / 3.0);
        assertThat(metrics.falsePositiveRate()).isEqualTo(1.0 / 3.0);
        // sup-1 为 PROJECT scope,覆盖全部命中;expired/inactive/其他规则均不生效
        assertThat(metrics.suppressionRate()).isEqualTo(1.0);
        // fp-1 在 contextMissing 集合内，fp-9 不在命中内不计入
        assertThat(metrics.noContextRate()).isEqualTo(1.0 / 5.0);
        assertThat(report.regression()).isEmpty();
        assertThat(report.omittedReasons()).isEmpty();
    }

    @Test
    void evaluate_suppressionMatching_respectsGlobPathAndState() {
        RuleEvaluationRequest request = new RuleEvaluationRequest(
                "java.command.injection", 2, "proj-1",
                List.of(
                        new RuleEvaluationHit("fp-1", "src/Main.java"),
                        new RuleEvaluationHit("fp-2", "src/util/Cmd.java"),
                        new RuleEvaluationHit("fp-3", "src/util/Exec.java"),
                        new RuleEvaluationHit("fp-4", "src/util/Run.java"),
                        new RuleEvaluationHit("fp-5", "src/util/Other.java")),
                Map.of(),
                List.of(globSuppression("sup-2", "src/util/*"),
                        expiredSuppression("sup-3"), inactiveSuppression("sup-4"),
                        otherRuleSuppression("sup-5")),
                Set.of(),
                null,
                "2026-10-12T08:00:00Z");

        // 仅 src/util/* 下四个命中被 FILE_GLOB 抑制,src/Main.java 不匹配;过期/停用/他规则不生效
        assertThat(evaluator.evaluate(request).metrics().suppressionRate()).isEqualTo(4.0 / 5.0);
    }

    @Test
    void evaluate_whenNoClearFeedback_ratesAreAbsentNotZero() {
        RuleEvaluationRequest request = new RuleEvaluationRequest(
                "java.command.injection", 1, "proj-1",
                List.of(new RuleEvaluationHit("fp-1", "src/Main.java")),
                Map.of("fp-1", TriageFeedbackStatus.NEEDS_REVIEW),
                List.of(),
                Set.of(),
                null,
                "2026-10-12T08:00:00Z");

        RuleMetricSet metrics = evaluator.evaluate(request).metrics();

        assertThat(metrics.hits()).isEqualTo(1);
        assertThat(metrics.needsReview()).isEqualTo(1);
        assertThat(metrics.confirmationRate()).isNull();
        assertThat(metrics.falsePositiveRate()).isNull();
    }

    @Test
    void evaluate_withZeroHits_reportsEmptyMetricsWithOmittedReason() {
        RuleEvaluationRequest request = new RuleEvaluationRequest(
                "java.command.injection", 1, "proj-1",
                List.of(),
                Map.of(),
                List.of(),
                Set.of(),
                null,
                "2026-10-12T08:00:00Z");

        RuleEvaluationReport report = evaluator.evaluate(request);

        RuleMetricSet metrics = report.metrics();
        assertThat(metrics.hits()).isZero();
        assertThat(metrics.confirmationRate()).isNull();
        assertThat(metrics.suppressionRate()).isNull();
        assertThat(metrics.noContextRate()).isNull();
        assertThat(report.omittedReasons()).anyMatch(reason -> reason.contains("无命中"));
    }

    @Test
    void evaluate_withPreviousReport_producesPerMetricRegression() {
        RuleEvaluationReport previous = evaluator.evaluate(new RuleEvaluationRequest(
                "java.command.injection", 1, "proj-1",
                List.of(
                        new RuleEvaluationHit("fp-1", "src/Main.java"),
                        new RuleEvaluationHit("fp-2", "src/util/Cmd.java")),
                Map.of(
                        "fp-1", TriageFeedbackStatus.TRUE_POSITIVE,
                        "fp-2", TriageFeedbackStatus.FALSE_POSITIVE),
                List.of(),
                Set.of(),
                null,
                "2026-10-11T08:00:00Z"));

        RuleEvaluationReport current = evaluator.evaluate(new RuleEvaluationRequest(
                "java.command.injection", 2, "proj-1",
                List.of(
                        new RuleEvaluationHit("fp-1", "src/Main.java"),
                        new RuleEvaluationHit("fp-2", "src/util/Cmd.java"),
                        new RuleEvaluationHit("fp-3", "src/util/Exec.java")),
                Map.of(
                        "fp-1", TriageFeedbackStatus.TRUE_POSITIVE,
                        "fp-2", TriageFeedbackStatus.FALSE_POSITIVE,
                        "fp-3", TriageFeedbackStatus.TRUE_POSITIVE),
                List.of(),
                Set.of(),
                previous,
                "2026-10-12T08:00:00Z"));

        assertThat(current.version()).isEqualTo(2);
        assertThat(current.regression()).hasSize(8);
        RuleMetricSet metrics = current.metrics();
        assertThat(metrics.hits()).isEqualTo(3);
        assertThat(metrics.confirmationRate()).isEqualTo(2.0 / 3.0);
        assertThat(findDelta(current, "hits").delta()).isEqualTo(1.0);
        assertThat(findDelta(current, "confirmationRate").delta())
                .isEqualTo(2.0 / 3.0 - 0.5);
        assertThat(findDelta(current, "suppressionRate").previous()).isNotNull().isEqualTo(0.0);
    }

    @Test
    void evaluate_whenPreviousRateAbsent_regressionDeltaIsNull() {
        RuleEvaluationReport previous = evaluator.evaluate(new RuleEvaluationRequest(
                "java.command.injection", 1, "proj-1",
                List.of(new RuleEvaluationHit("fp-1", "src/Main.java")),
                Map.of("fp-1", TriageFeedbackStatus.NEEDS_REVIEW),
                List.of(),
                Set.of(),
                null,
                "2026-10-11T08:00:00Z"));

        RuleEvaluationReport current = evaluator.evaluate(new RuleEvaluationRequest(
                "java.command.injection", 2, "proj-1",
                List.of(new RuleEvaluationHit("fp-1", "src/Main.java")),
                Map.of("fp-1", TriageFeedbackStatus.TRUE_POSITIVE),
                List.of(),
                Set.of(),
                previous,
                "2026-10-12T08:00:00Z"));

        assertThat(findDelta(current, "confirmationRate").previous()).isNull();
        assertThat(findDelta(current, "confirmationRate").current()).isEqualTo(1.0);
        assertThat(findDelta(current, "confirmationRate").delta()).isNull();
    }

    @Test
    void constructor_rejectsBlankRuleId() {
        assertThatThrownBy(() -> new RuleEvaluationRequest(
                " ", 1, "proj-1", List.of(), Map.of(), List.of(), Set.of(), null,
                "2026-10-12T08:00:00Z"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static RuleMetricDelta findDelta(RuleEvaluationReport report, String metric) {
        return report.regression().stream()
                .filter(delta -> delta.metric().equals(metric))
                .findFirst()
                .orElseThrow();
    }

    private static RuleSuppression projectSuppression(String id) {
        return suppression(id, RuleSuppressionScope.PROJECT, "");
    }

    private static RuleSuppression globSuppression(String id, String glob) {
        return suppression(id, RuleSuppressionScope.FILE_GLOB, glob);
    }

    private static RuleSuppression expiredSuppression(String id) {
        return new RuleSuppression(id, "proj-1", "java.command.injection",
                RuleSuppressionScope.PROJECT, "", "reason", "alice",
                "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z", true);
    }

    private static RuleSuppression inactiveSuppression(String id) {
        return new RuleSuppression(id, "proj-1", "java.command.injection",
                RuleSuppressionScope.PROJECT, "", "reason", "alice",
                "2026-09-01T00:00:00Z", "2027-01-01T00:00:00Z", false);
    }

    private static RuleSuppression otherRuleSuppression(String id) {
        return new RuleSuppression(id, "proj-1", "other.rule",
                RuleSuppressionScope.PROJECT, "", "reason", "alice",
                "2026-09-01T00:00:00Z", "2027-01-01T00:00:00Z", true);
    }

    private static RuleSuppression suppression(String id, RuleSuppressionScope scope, String scopeValue) {
        return new RuleSuppression(id, "proj-1", "java.command.injection", scope, scopeValue,
                "reason", "alice", "2026-09-01T00:00:00Z", "2027-01-01T00:00:00Z", true);
    }
}
