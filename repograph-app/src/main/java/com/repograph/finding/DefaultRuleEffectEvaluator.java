package com.repograph.finding;

import com.repograph.core.finding.RuleEvaluationHit;
import com.repograph.core.finding.RuleEvaluationReport;
import com.repograph.core.finding.RuleEvaluationRequest;
import com.repograph.core.finding.RuleEffectEvaluator;
import com.repograph.core.finding.RuleMetricDelta;
import com.repograph.core.finding.RuleMetricSet;
import com.repograph.core.finding.RuleSuppression;
import com.repograph.core.finding.TriageFeedbackStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 规则效果评估的纯函数实现：只消费请求中的事实集合，不访问数据库或文件系统。指标分母不存在时
 * 输出 {@code null} 而非 0%；抑制匹配复用 {@link RuleSuppressionStore#matchesScope} 的统一
 * glob 语义。
 *
 * @author leolu
 */
@Service
public class DefaultRuleEffectEvaluator implements RuleEffectEvaluator {

    @Override
    public RuleEvaluationReport evaluate(RuleEvaluationRequest request) {
        List<String> omittedReasons = new ArrayList<>();

        Map<String, RuleEvaluationHit> uniqueHits = new LinkedHashMap<>();
        for (RuleEvaluationHit hit : request.hits()) {
            uniqueHits.putIfAbsent(hit.fingerprint(), hit);
        }
        int hits = uniqueHits.size();

        int confirmed = 0;
        int falsePositives = 0;
        int needsReview = 0;
        Map<String, TriageFeedbackStatus> feedback = request.feedbackByFingerprint();
        for (String fingerprint : uniqueHits.keySet()) {
            TriageFeedbackStatus status = feedback.get(fingerprint);
            if (status == null) {
                continue;
            }
            switch (status) {
                case TRUE_POSITIVE, FIXED -> confirmed++;
                case FALSE_POSITIVE -> falsePositives++;
                case NEEDS_REVIEW -> needsReview++;
            }
        }

        int reviewed = confirmed + falsePositives;
        Double confirmationRate = reviewed == 0 ? null : (double) confirmed / reviewed;
        Double falsePositiveRate = reviewed == 0 ? null : (double) falsePositives / reviewed;

        Instant now;
        try {
            now = Instant.parse(request.generatedAt());
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("generatedAt must be an ISO-8601 instant", e);
        }
        List<RuleSuppression> applicable = request.suppressions().stream()
                .filter(candidate -> candidate.ruleId().equals(request.ruleId()))
                .filter(RuleSuppression::active)
                .filter(candidate -> {
                    try {
                        return Instant.parse(candidate.expiresAt()).isAfter(now);
                    } catch (DateTimeParseException e) {
                        omittedReasons.add("抑制策略 " + candidate.id() + " 过期时间不可解析，已跳过");
                        return false;
                    }
                })
                .toList();
        int suppressed = 0;
        for (RuleEvaluationHit hit : uniqueHits.values()) {
            if (isSuppressed(hit, applicable)) {
                suppressed++;
            }
        }
        Double suppressionRate = hits == 0 ? null : (double) suppressed / hits;

        int contextMissing = 0;
        for (String fingerprint : request.contextMissingFingerprints()) {
            if (uniqueHits.containsKey(fingerprint)) {
                contextMissing++;
            }
        }
        Double noContextRate = hits == 0 ? null : (double) contextMissing / hits;

        if (hits == 0) {
            omittedReasons.add("评估范围内该规则无命中报警");
        }

        RuleMetricSet metrics = new RuleMetricSet(
                hits, confirmed, falsePositives, needsReview,
                confirmationRate, falsePositiveRate, suppressionRate, noContextRate);
        List<RuleMetricDelta> regression = buildRegression(request.previous(), metrics);
        return new RuleEvaluationReport(
                request.ruleId(), request.version(), request.projectId(),
                metrics, regression, omittedReasons, request.generatedAt());
    }

    private static boolean isSuppressed(RuleEvaluationHit hit, List<RuleSuppression> applicable) {
        if (hit.filePath() == null || hit.filePath().isBlank()) {
            return false;
        }
        return applicable.stream().anyMatch(candidate -> RuleSuppressionStore.matchesScope(candidate, hit.filePath()));
    }

    private static List<RuleMetricDelta> buildRegression(RuleEvaluationReport previous, RuleMetricSet current) {
        if (previous == null) {
            return List.of();
        }
        RuleMetricSet prior = previous.metrics();
        List<RuleMetricDelta> deltas = new ArrayList<>();
        deltas.add(RuleMetricDelta.of("hits", (double) prior.hits(), (double) current.hits()));
        deltas.add(RuleMetricDelta.of("confirmed", (double) prior.confirmed(), (double) current.confirmed()));
        deltas.add(RuleMetricDelta.of("falsePositives", (double) prior.falsePositives(), (double) current.falsePositives()));
        deltas.add(RuleMetricDelta.of("needsReview", (double) prior.needsReview(), (double) current.needsReview()));
        deltas.add(RuleMetricDelta.of("confirmationRate", prior.confirmationRate(), current.confirmationRate()));
        deltas.add(RuleMetricDelta.of("falsePositiveRate", prior.falsePositiveRate(), current.falsePositiveRate()));
        deltas.add(RuleMetricDelta.of("suppressionRate", prior.suppressionRate(), current.suppressionRate()));
        deltas.add(RuleMetricDelta.of("noContextRate", prior.noContextRate(), current.noContextRate()));
        return List.copyOf(deltas);
    }
}
