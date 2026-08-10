package com.repograph.architecture;

import com.repograph.core.architecture.ArchitectureEvidence;
import com.repograph.core.architecture.ArchitectureModelResponse;
import com.repograph.core.architecture.ArchitectureReviewCandidate;
import com.repograph.core.architecture.ArchitectureReviewInput;
import com.repograph.core.architecture.ArchitectureReviewModel;
import com.repograph.core.architecture.ArchitectureReviewResult;
import com.repograph.core.architecture.ArchitectureReviewService;
import com.repograph.core.architecture.ArchitectureReviewStatus;
import com.repograph.metrics.ComplexityMetric;
import com.repograph.metrics.CouplingMetric;
import com.repograph.metrics.GitChurnAnalyzer;
import com.repograph.metrics.HealthReport;
import com.repograph.metrics.HealthReportService;
import com.repograph.metrics.HotspotMetric;
import com.repograph.metrics.PackageCycle;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;

/**
 * 基于静态指标事实和受约束模型建议的默认架构评审实现。
 *
 * @author leolu
 */
@Service
public class DefaultArchitectureReviewService implements ArchitectureReviewService {

    private static final String METHODOLOGY = "FORGEFLOW_ARCHITECTURE_U1-U8@0.2.1";

    private final HealthReportService healthReportService;
    private final GitChurnAnalyzer gitChurnAnalyzer;
    private final ArchitectureReviewModel model;

    /**
     * 创建默认架构评审模块。
     *
     * @param healthReportService 指标聚合模块
     * @param gitChurnAnalyzer    变更热点分析器
     * @param model               架构评审模型 seam
     */
    public DefaultArchitectureReviewService(
            HealthReportService healthReportService,
            GitChurnAnalyzer gitChurnAnalyzer,
            ArchitectureReviewModel model) {
        this.healthReportService = healthReportService;
        this.gitChurnAnalyzer = gitChurnAnalyzer;
        this.model = model;
    }

    @Override
    public ArchitectureReviewResult review(String projectId) {
        return reviewInternal(projectId, null);
    }

    @Override
    public ArchitectureReviewResult reviewStreaming(String projectId, Consumer<String> deltaConsumer) {
        return reviewInternal(projectId, deltaConsumer);
    }

    private ArchitectureReviewResult reviewInternal(String projectId, Consumer<String> deltaConsumer) {
        HealthReport report = healthReportService.generate(projectId);
        List<ArchitectureEvidence> evidence = collectEvidence(report, gitChurnAnalyzer.topHotspots(projectId, 5));
        String generatedAt = Instant.now().toString();
        if (!model.available()) {
            return new ArchitectureReviewResult(
                    projectId, ArchitectureReviewStatus.DISABLED, METHODOLOGY, model.modelId(), generatedAt,
                    List.of("静态架构风险事实已收集，模型建议未运行。"), List.of(),
                    List.of("请在 Agent 作战台启用并验证 Ollama LLM。"), evidence);
        }
        try {
            ArchitectureReviewInput input = new ArchitectureReviewInput(
                    projectId, report.projectRoot(), report.generatedAt(), report.healthScore(), evidence);
            ArchitectureModelResponse response = deltaConsumer == null
                    ? model.review(input)
                    : model.reviewStreaming(input, deltaConsumer);
            Validation validation = validate(response, evidence);
            return new ArchitectureReviewResult(
                    projectId, ArchitectureReviewStatus.COMPLETED, METHODOLOGY, model.modelId(), generatedAt,
                    response.observations(), validation.candidates(), validation.missingInfo(), evidence);
        } catch (RuntimeException e) {
            return new ArchitectureReviewResult(
                    projectId, ArchitectureReviewStatus.FAILED, METHODOLOGY, model.modelId(), generatedAt,
                    List.of("静态架构风险事实已收集，但模型建议生成失败。"), List.of(),
                    List.of(e.getMessage() == null ? "模型调用失败" : e.getMessage()), evidence);
        }
    }

    private static List<ArchitectureEvidence> collectEvidence(
            HealthReport report, List<HotspotMetric> hotspots) {
        List<ArchitectureEvidence> evidence = new ArrayList<>();
        evidence.add(new ArchitectureEvidence(
                "ARCH-HEALTH", "HEALTH", report.projectRoot(),
                "健康分=" + report.healthScore() + ", 高复杂方法=" + report.highComplexityMethods()
                        + ", 高不稳定类=" + report.highInstabilityClasses() + ", 包循环=" + report.packageCycles()
                        + ", 疑似死代码=" + report.deadCodeCount() + ", 测试空白=" + report.testGapCount()));
        int index = 1;
        for (ComplexityMetric metric : report.topComplexMethods()) {
            evidence.add(new ArchitectureEvidence(
                    "ARCH-CC-" + index++, "COMPLEXITY", metric.filePath() + ":" + metric.startLine(),
                    metric.qualifiedName() + " 的启发式圈复杂度=" + metric.complexity()));
        }
        index = 1;
        for (CouplingMetric metric : report.topInstableCouplings()) {
            evidence.add(new ArchitectureEvidence(
                    "ARCH-COUPLING-" + index++, "COUPLING", metric.classQualifiedName(),
                    "Ca=" + metric.fanIn() + ", Ce=" + metric.fanOut() + ", I=" + metric.instability()));
        }
        index = 1;
        for (PackageCycle cycle : report.packageCycleList()) {
            evidence.add(new ArchitectureEvidence(
                    "ARCH-CYCLE-" + index++, "PACKAGE_CYCLE", String.join(" → ", cycle.packages()),
                    "包级强连通分量包含 " + cycle.packages().size() + " 个包"));
        }
        index = 1;
        for (HotspotMetric hotspot : hotspots) {
            evidence.add(new ArchitectureEvidence(
                    "ARCH-HOTSPOT-" + index++, "CHANGE_RISK", hotspot.filePath(),
                    "变更次数=" + hotspot.churnCount() + ", 平均复杂度=" + hotspot.avgComplexity()
                            + ", 热点分=" + hotspot.hotspotScore()));
        }
        return List.copyOf(evidence);
    }

    private static Validation validate(
            ArchitectureModelResponse response, List<ArchitectureEvidence> evidence) {
        Set<String> allowed = new HashSet<>();
        evidence.forEach(item -> allowed.add(item.citationId()));
        List<String> missing = new ArrayList<>(response.missingInfo());
        List<ArchitectureReviewCandidate> candidates = response.candidates().stream()
                .limit(5)
                .map(candidate -> {
                    List<String> citations = candidate.citations() == null
                            ? List.of()
                            : candidate.citations().stream().filter(allowed::contains).distinct().toList();
                    if (candidate.citations() != null && citations.size() != candidate.citations().size()) {
                        missing.add("候选“" + candidate.title() + "”包含未知引用，已从结果中剔除。 ");
                    }
                    return new ArchitectureReviewCandidate(
                            candidate.priority(), candidate.title(), candidate.location(), candidate.problem(),
                            candidate.suggestion(), candidate.benefit(), candidate.cost(), candidate.risk(),
                            candidate.methodology(), citations);
                })
                .sorted(Comparator.comparingInt(ArchitectureReviewCandidate::priority))
                .toList();
        return new Validation(candidates, List.copyOf(missing));
    }

    private record Validation(
            List<ArchitectureReviewCandidate> candidates,
            List<String> missingInfo) {
    }
}
