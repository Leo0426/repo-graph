package com.repograph.advisory;

import com.repograph.core.advisory.LabeledAdvisorySample;
import com.repograph.core.advisory.LlmAdvisoryEvaluation;
import com.repograph.core.advisory.LlmAdvisoryResult;
import com.repograph.core.advisory.LlmAdvisoryStatus;
import com.repograph.core.advisory.LlmUsage;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
import com.repograph.core.retrieval.ContextPack;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.within;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link LlmAdvisoryEvaluator} 固定标注集测试。
 *
 * @author leolu
 */
class LlmAdvisoryEvaluatorTest {

    @Test
    void evaluate_comparesHeuristicAndAvailableAdvisoryWithLatencyAndCost() {
        List<LabeledAdvisorySample> samples = List.of(
                sample("S1", TriageVerdict.TRUE_RISK, TriageVerdict.TRUE_RISK,
                        TriageVerdict.TRUE_RISK, 40L, 0.01d),
                sample("S2", TriageVerdict.LIKELY_FALSE_POSITIVE, TriageVerdict.TRUE_RISK,
                        TriageVerdict.LIKELY_FALSE_POSITIVE, 60L, 0.02d),
                sample("S3", TriageVerdict.NEEDS_REVIEW, TriageVerdict.NEEDS_REVIEW,
                        null, 0L, 0.0d));

        LlmAdvisoryEvaluation evaluation = new LlmAdvisoryEvaluator().evaluate(samples);

        assertThat(evaluation.sampleCount()).isEqualTo(3);
        assertThat(evaluation.heuristicCorrect()).isEqualTo(2);
        assertThat(evaluation.heuristicAccuracy()).isEqualTo(2.0d / 3.0d);
        assertThat(evaluation.advisoryAvailable()).isEqualTo(2);
        assertThat(evaluation.advisoryCorrect()).isEqualTo(2);
        assertThat(evaluation.advisoryAccuracy()).isEqualTo(1.0d);
        assertThat(evaluation.averageLatencyMs()).isEqualTo(50.0d);
        assertThat(evaluation.totalEstimatedCostUsd()).isCloseTo(0.03d, within(0.000_001d));
    }

    private static LabeledAdvisorySample sample(
            String id,
            TriageVerdict expected,
            TriageVerdict heuristicVerdict,
            TriageVerdict advisoryVerdict,
            long latencyMs,
            double cost) {
        TriageReport report = report(id, heuristicVerdict);
        LlmAdvisoryResult advisory = advisoryVerdict == null
                ? LlmAdvisoryResult.disabled(report)
                : new LlmAdvisoryResult(
                        report,
                        LlmAdvisoryStatus.COMPLETED,
                        true,
                        true,
                        "fake",
                        "evaluation-model",
                        advisoryVerdict,
                        0.2f,
                        List.of(),
                        List.of(),
                        0,
                        1,
                        latencyMs,
                        new LlmUsage(10, 5, cost));
        return new LabeledAdvisorySample(id, expected, report, advisory);
    }

    private static TriageReport report(String id, TriageVerdict verdict) {
        ExternalFinding finding = new ExternalFinding(
                "fixture",
                "rule-" + id,
                "CWE-78",
                ExternalFindingSeverity.HIGH,
                "fixed evaluation sample",
                "src/" + id + ".java",
                1,
                1,
                "",
                List.of(),
                "");
        ContextPack pack = new ContextPack("q", "security", List.of(), List.of(), 100, 0, 0, 0, 0, 0);
        return new TriageReport(
                finding,
                true,
                id,
                verdict,
                0.8f,
                List.of(),
                List.of(),
                "",
                "",
                pack);
    }
}
