package com.repograph.api;

import com.repograph.metrics.ComplexityAnalyzer;
import com.repograph.metrics.ComplexityMetric;
import com.repograph.metrics.CouplingAnalyzer;
import com.repograph.metrics.CouplingMetric;
import com.repograph.metrics.GitChurnAnalyzer;
import com.repograph.metrics.HealthReport;
import com.repograph.metrics.HealthReportService;
import com.repograph.metrics.HotspotMetric;
import com.repograph.metrics.PackageCycle;
import com.repograph.metrics.PackageCycleDetector;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 代码质量指标 REST API。
 *
 * <ul>
 *   <li>{@code GET /api/v1/metrics/complexity?projectId=&limit=20} — 圈复杂度 Top-N</li>
 *   <li>{@code GET /api/v1/metrics/coupling?projectId=&sort=fanout&limit=20} — 类耦合度 Top-N</li>
 *   <li>{@code GET /api/v1/metrics/cycles?projectId=} — 包级别循环依赖（Tarjan SCC）</li>
 *   <li>{@code GET /api/v1/metrics/report?projectId=} — 六维度项目健康报告（含健康分）</li>
 *   <li>{@code GET /api/v1/metrics/hotspots?projectId=&limit=10} — Git 变更频率 × 复杂度热点</li>
 * </ul>
 *
 * @author leolu
 * @since 0.6.0
 */
@RestController
@RequestMapping("/api/v1/metrics")
public class MetricsController {

    private final ComplexityAnalyzer complexityAnalyzer;
    private final CouplingAnalyzer couplingAnalyzer;
    private final PackageCycleDetector cycleDetector;
    private final HealthReportService healthReportService;
    private final GitChurnAnalyzer gitChurnAnalyzer;

    public MetricsController(ComplexityAnalyzer complexityAnalyzer,
                             CouplingAnalyzer couplingAnalyzer,
                             PackageCycleDetector cycleDetector,
                             HealthReportService healthReportService,
                             GitChurnAnalyzer gitChurnAnalyzer) {
        this.complexityAnalyzer = complexityAnalyzer;
        this.couplingAnalyzer = couplingAnalyzer;
        this.cycleDetector = cycleDetector;
        this.healthReportService = healthReportService;
        this.gitChurnAnalyzer = gitChurnAnalyzer;
    }

    /**
     * 返回指定项目圈复杂度最高的前 N 个方法，按复杂度降序。
     *
     * @param projectId 项目 ID
     * @param limit     返回条数上限，默认 20
     * @return 圈复杂度指标列表
     */
    @GetMapping("/complexity")
    public List<ComplexityMetric> complexity(
            @RequestParam String projectId,
            @RequestParam(defaultValue = "20") int limit) {
        return complexityAnalyzer.topComplex(projectId, Math.min(limit, 100));
    }

    /**
     * 返回指定项目类级别耦合度最高的前 N 个类。
     *
     * @param projectId 项目 ID
     * @param sort      排序依据：{@code fanout}（默认，传出耦合降序）或 {@code fanin}（传入耦合降序）
     * @param limit     返回条数上限，默认 20
     * @return 耦合度指标列表
     */
    @GetMapping("/coupling")
    public List<CouplingMetric> coupling(
            @RequestParam String projectId,
            @RequestParam(defaultValue = "fanout") String sort,
            @RequestParam(defaultValue = "20") int limit) {
        int effectiveLimit = Math.min(limit, 100);
        return "fanin".equalsIgnoreCase(sort)
                ? couplingAnalyzer.topByFanIn(projectId, effectiveLimit)
                : couplingAnalyzer.topByFanOut(projectId, effectiveLimit);
    }

    /**
     * 检测指定项目中存在循环依赖的包组（Tarjan SCC）。
     *
     * @param projectId 项目 ID
     * @return 循环依赖包组列表，按环大小降序；无循环时返回空列表
     */
    @GetMapping("/cycles")
    public List<PackageCycle> cycles(@RequestParam String projectId) {
        return cycleDetector.findCycles(projectId);
    }

    /**
     * 生成指定项目的六维度代码健康报告，包含综合健康分和各项指标详情。
     *
     * @param projectId 项目 ID
     * @return 健康报告快照
     */
    @GetMapping("/report")
    public HealthReport report(@RequestParam String projectId) {
        return healthReportService.generate(projectId);
    }

    /**
     * 返回指定项目 Git 变更频率 × 圈复杂度最高的前 N 个热点文件。
     *
     * <p>若项目不在 Git 仓库中，或无复杂度数据，返回空列表。
     *
     * @param projectId 项目 ID
     * @param limit     最大返回数量，默认 10
     * @return 热点文件列表，按热点分降序
     */
    @GetMapping("/hotspots")
    public List<HotspotMetric> hotspots(
            @RequestParam String projectId,
            @RequestParam(defaultValue = "10") int limit) {
        return gitChurnAnalyzer.topHotspots(projectId, Math.min(limit, 50));
    }
}
