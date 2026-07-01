package com.repograph.metrics;

import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import com.repograph.core.graph.ProjectStats;
import com.repograph.vuln.VulnFinding;
import com.repograph.vuln.VulnStore;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 项目代码健康报告生成器，聚合漏洞、复杂度、耦合、包循环、死代码和测试空白六个维度。
 *
 * <p>健康分计算规则（起始 100 分，累计扣分，下限 0）：
 * <ul>
 *   <li>CRITICAL/HIGH/MEDIUM/LOW 漏洞（仅活跃状态）×15/10/5/2</li>
 *   <li>包循环 ×10（上限 −30）</li>
 *   <li>CC&gt;10 方法 ×2（上限 −20）</li>
 *   <li>高不稳定类（I&gt;0.8）×1（上限 −10）</li>
 *   <li>测试空白率 &gt;70%：−15；&gt;50%：−10；&gt;30%：−5</li>
 *   <li>死代码率 &gt;10%：−5</li>
 * </ul>
 *
 * @author leolu
 * @since 0.6.0
 */
@Service
public class HealthReportService {

    private final VulnStore vulnStore;
    private final ComplexityAnalyzer complexityAnalyzer;
    private final CouplingAnalyzer couplingAnalyzer;
    private final PackageCycleDetector packageCycleDetector;
    private final GraphQueryService graphQueryService;
    private final GraphDiagnosticsService graphDiagnosticsService;

    public HealthReportService(VulnStore vulnStore,
                               ComplexityAnalyzer complexityAnalyzer,
                               CouplingAnalyzer couplingAnalyzer,
                               PackageCycleDetector packageCycleDetector,
                               GraphQueryService graphQueryService,
                               GraphDiagnosticsService graphDiagnosticsService) {
        this.vulnStore = vulnStore;
        this.complexityAnalyzer = complexityAnalyzer;
        this.couplingAnalyzer = couplingAnalyzer;
        this.packageCycleDetector = packageCycleDetector;
        this.graphQueryService = graphQueryService;
        this.graphDiagnosticsService = graphDiagnosticsService;
    }

    /**
     * 生成指定项目的健康报告快照。
     *
     * @param projectId 项目唯一标识符
     * @return 健康报告；若项目未索引则各计数均为 0
     */
    public HealthReport generate(String projectId) {
        // ── 基础统计 ──────────────────────────────────────────────────────────
        ProjectStats stats = graphQueryService.projectStats(projectId);
        String projectRoot = graphQueryService.listProjects().stream()
                .filter(p -> projectId.equals(p.projectId()))
                .map(ProjectInfo::projectRoot)
                .findFirst()
                .orElse(projectId);

        // ── 漏洞（仅活跃：SUSPECTED + CONFIRMED）────────────────────────────
        List<VulnFinding> activeVulns = vulnStore.list(projectId, null, null).stream()
                .filter(f -> VulnFinding.SUSPECTED.equals(f.status())
                        || VulnFinding.CONFIRMED.equals(f.status()))
                .toList();
        Map<String, Long> vulnBySeverity = activeVulns.stream()
                .collect(Collectors.groupingBy(f -> f.severity().toUpperCase(), Collectors.counting()));
        long vulnCritical = vulnBySeverity.getOrDefault("CRITICAL", 0L);
        long vulnHigh     = vulnBySeverity.getOrDefault("HIGH", 0L);
        long vulnMedium   = vulnBySeverity.getOrDefault("MEDIUM", 0L);
        long vulnLow      = vulnBySeverity.getOrDefault("LOW", 0L);

        // ── 圈复杂度 ──────────────────────────────────────────────────────────
        List<ComplexityMetric> allComplex = complexityAnalyzer.topComplex(projectId, 10_000);
        int highComplexity = (int) allComplex.stream().filter(c -> c.complexity() > 10).count();
        List<ComplexityMetric> topComplex = allComplex.stream()
                .sorted(Comparator.comparingInt(ComplexityMetric::complexity).reversed())
                .limit(5)
                .toList();

        // ── 类耦合度 ──────────────────────────────────────────────────────────
        List<CouplingMetric> allCoupling = couplingAnalyzer.compute(projectId);
        int highInstability = (int) allCoupling.stream()
                .filter(c -> c.instability() > 0.8)
                .count();
        List<CouplingMetric> topInstable = allCoupling.stream()
                .sorted(Comparator.comparingDouble(CouplingMetric::instability).reversed())
                .limit(5)
                .toList();

        // ── 包循环 ────────────────────────────────────────────────────────────
        List<PackageCycle> cycles = packageCycleDetector.findCycles(projectId);

        // ── 死代码与测试空白 ──────────────────────────────────────────────────
        long deadCodeCount = graphDiagnosticsService.findDeadCode(projectId).size();
        List<?> testGaps = graphDiagnosticsService.findTestGaps(projectId);
        long testGapCount = testGaps.size();
        long totalProductionMethods = graphDiagnosticsService.listScanTargets(projectId).size();

        // ── 健康分 ────────────────────────────────────────────────────────────
        int score = computeScore(
                vulnCritical, vulnHigh, vulnMedium, vulnLow,
                cycles.size(), highComplexity, highInstability,
                testGapCount, totalProductionMethods,
                deadCodeCount);

        return new HealthReport(
                projectId, projectRoot, Instant.now().toString(), score,
                stats.totalUnits(), stats.totalFiles(), stats.totalEdges(),
                vulnCritical, vulnHigh, vulnMedium, vulnLow,
                cycles.size(), highComplexity, highInstability,
                deadCodeCount, testGapCount, totalProductionMethods,
                topComplex, topInstable,
                cycles.size() > 10 ? cycles.subList(0, 10) : cycles);
    }

    // ── 健康分计算公式（静态方法，便于单测）────────────────────────────────

    static int computeScore(long vulnCritical, long vulnHigh, long vulnMedium, long vulnLow,
                            int packageCycles, int highComplexityMethods, int highInstabilityClasses,
                            long testGapCount, long totalProductionMethods, long deadCodeCount) {
        int score = 100;
        score -= (int) Math.min(vulnCritical * 15L, 45);
        score -= (int) Math.min(vulnHigh * 10L, 40);
        score -= (int) Math.min(vulnMedium * 5L, 20);
        score -= (int) Math.min(vulnLow * 2L, 10);
        score -= Math.min(packageCycles * 10, 30);
        score -= Math.min(highComplexityMethods * 2, 20);
        score -= Math.min(highInstabilityClasses, 10);

        if (totalProductionMethods > 0) {
            double gapRatio = (double) testGapCount / totalProductionMethods;
            if (gapRatio > 0.70) score -= 15;
            else if (gapRatio > 0.50) score -= 10;
            else if (gapRatio > 0.30) score -= 5;

            double dcRatio = (double) deadCodeCount / totalProductionMethods;
            if (dcRatio > 0.10) score -= 5;
        }

        return Math.max(0, score);
    }
}
