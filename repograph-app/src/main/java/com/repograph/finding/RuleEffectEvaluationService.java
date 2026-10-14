package com.repograph.finding;

import com.repograph.core.finding.DetectionRule;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.RuleEvaluationHit;
import com.repograph.core.finding.RuleEvaluationReport;
import com.repograph.core.finding.RuleEvaluationRequest;
import com.repograph.core.finding.RuleEffectEvaluator;
import com.repograph.core.finding.RuleNotFoundException;
import com.repograph.core.finding.RuleRegistry;
import com.repograph.core.finding.RuleSuppression;
import com.repograph.core.finding.ReviewQueueEntry;
import com.repograph.core.finding.TriageFeedback;
import com.repograph.core.finding.TriageFeedbackStatus;
import com.repograph.core.finding.TriageReport;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 规则效果评估的装配服务：从审核队列、人工反馈、抑制策略与研判快照收集事实，
 * 委托纯函数 {@link RuleEffectEvaluator} 计算，并把结果持久化为回归快照。
 * 命中锚定审核队列条目；文件路径与上下文定位信号来自条目所属快照内的研判报告
 * （{@code located == false} 记为无上下文）。本服务不复制任何领域事实。
 *
 * @author leolu
 */
@Service
public class RuleEffectEvaluationService {

    private final RuleRegistry registry;
    private final ReviewQueueStore reviewQueueStore;
    private final TriageFeedbackStore feedbackStore;
    private final RuleSuppressionStore suppressionStore;
    private final RuleEffectEvaluator evaluator;
    private final RuleEvaluationStore evaluationStore;

    /**
     * 创建评估装配服务。
     *
     * @param registry          规则注册表
     * @param reviewQueueStore  审核队列存储（命中来源）
     * @param feedbackStore     人工反馈存储
     * @param suppressionStore  规则抑制存储
     * @param evaluator         纯函数评估器
     * @param evaluationStore   评估快照存储
     */
    public RuleEffectEvaluationService(
            RuleRegistry registry,
            ReviewQueueStore reviewQueueStore,
            TriageFeedbackStore feedbackStore,
            RuleSuppressionStore suppressionStore,
            RuleEffectEvaluator evaluator,
            RuleEvaluationStore evaluationStore) {
        this.registry = registry;
        this.reviewQueueStore = reviewQueueStore;
        this.feedbackStore = feedbackStore;
        this.suppressionStore = suppressionStore;
        this.evaluator = evaluator;
        this.evaluationStore = evaluationStore;
    }

    /**
     * 即时评估指定规则的 active 版本（无 active 时评估最高已注册版本），持久化快照并返回。
     *
     * @param ruleId    规则标识
     * @param projectId 项目标识（评估范围）
     * @return 评估报告
     * @throws RuleNotFoundException 规则不存在任何版本
     */
    public RuleEvaluationReport evaluate(String ruleId, String projectId) {
        List<String> omitted = new ArrayList<>();
        DetectionRule rule = resolveRule(ruleId, omitted);

        List<ReviewQueueEntry> entries =
                reviewQueueStore.list(projectId, null, null, null, ruleId, null, null, null, null);
        Map<String, ReviewQueueEntry> unique = new LinkedHashMap<>();
        for (var entry : entries) {
            unique.merge(entry.fingerprint(), entry, (a, b) ->
                    a.updatedAt().compareTo(b.updatedAt()) >= 0 ? a : b);
        }

        Map<String, RuleEvaluationHit> hits = new LinkedHashMap<>();
        Set<String> contextMissing = new LinkedHashSet<>();
        Map<String, Optional<Map<String, TriageReport>>> snapshotCache = new LinkedHashMap<>();
        for (var entry : unique.values()) {
            Map<String, TriageReport> reports = reportsOf(entry.snapshotId(), snapshotCache, omitted);
            TriageReport report = reports.get(entry.fingerprint());
            if (report == null) {
                omitted.add("命中 " + entry.fingerprint() + " 所在快照中未找到对应研判报告");
                hits.put(entry.fingerprint(), new RuleEvaluationHit(entry.fingerprint(), null));
                continue;
            }
            ExternalFinding finding = report.finding();
            hits.put(entry.fingerprint(),
                    new RuleEvaluationHit(entry.fingerprint(), finding.filePath()));
            if (!report.located()) {
                contextMissing.add(entry.fingerprint());
            }
        }

        Map<String, TriageFeedbackStatus> feedback = new LinkedHashMap<>();
        for (TriageFeedback item : feedbackStore.list(projectId, null)) {
            if (unique.containsKey(item.fingerprint())) {
                feedback.putIfAbsent(item.fingerprint(), item.status());
            }
        }

        List<RuleSuppression> suppressions = suppressionStore.list(projectId, ruleId);
        RuleEvaluationReport previous = evaluationStore.latest(projectId, ruleId).orElse(null);
        RuleEvaluationRequest request = new RuleEvaluationRequest(
                ruleId, rule.version(), projectId,
                List.copyOf(hits.values()), Map.copyOf(feedback), suppressions,
                Set.copyOf(contextMissing), previous, Instant.now().toString());
        RuleEvaluationReport report = evaluator.evaluate(request);
        if (!omitted.isEmpty()) {
            List<String> merged = new ArrayList<>(omitted);
            merged.addAll(report.omittedReasons());
            report = new RuleEvaluationReport(report.ruleId(), report.version(), report.projectId(),
                    report.metrics(), report.regression(), List.copyOf(merged), report.generatedAt());
        }
        evaluationStore.save(report);
        return report;
    }

    /**
     * 列出指定规则的全部评估快照，生成时间倒序；相邻两条即为版本回归对比视图。
     *
     * @param ruleId    规则标识
     * @param projectId 项目标识
     * @return 快照报告列表
     */
    public List<RuleEvaluationReport> history(String ruleId, String projectId) {
        return evaluationStore.list(projectId, ruleId);
    }

    private DetectionRule resolveRule(String ruleId, List<String> omitted) {
        Optional<DetectionRule> active = registry.findActive(ruleId);
        if (active.isPresent()) {
            return active.get();
        }
        List<DetectionRule> versions = registry.list(ruleId);
        if (versions.isEmpty()) {
            throw new RuleNotFoundException("rule not found: " + ruleId);
        }
        DetectionRule latest = versions.stream()
                .max(Comparator.comparingInt(DetectionRule::version))
                .orElseThrow();
        omitted.add("规则当前无 active 版本，评估最高已注册版本 v" + latest.version());
        return latest;
    }

    private Map<String, TriageReport> reportsOf(
            String snapshotId,
            Map<String, Optional<Map<String, TriageReport>>> cache,
            List<String> omitted) {
        if (cache.containsKey(snapshotId)) {
            return cache.get(snapshotId).orElse(Map.of());
        }
        Optional<Map<String, TriageReport>> reports = reviewQueueStore.getSnapshot(snapshotId)
                .map(snapshot -> {
                    Map<String, TriageReport> byFingerprint = new LinkedHashMap<>();
                    for (TriageReport report : snapshot.reports()) {
                        byFingerprint.putIfAbsent(report.finding().fingerprint(), report);
                    }
                    return byFingerprint;
                });
        if (reports.isEmpty()) {
            omitted.add("命中所属快照 " + snapshotId + " 不存在，文件路径与上下文信号缺失");
        }
        cache.put(snapshotId, reports);
        return reports.orElse(Map.of());
    }
}
