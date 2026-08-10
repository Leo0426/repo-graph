package com.repograph.architecture;

import com.repograph.core.architecture.ArchitectureModelResponse;
import com.repograph.core.architecture.ArchitectureReviewCandidate;
import com.repograph.core.architecture.ArchitectureReviewInput;
import com.repograph.core.architecture.ArchitectureReviewModel;
import com.repograph.core.architecture.ArchitectureReviewStatus;
import com.repograph.metrics.ComplexityMetric;
import com.repograph.metrics.CouplingMetric;
import com.repograph.metrics.GitChurnAnalyzer;
import com.repograph.metrics.HealthReport;
import com.repograph.metrics.HealthReportService;
import com.repograph.metrics.HotspotMetric;
import com.repograph.metrics.PackageCycle;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@link DefaultArchitectureReviewService} 的证据组装与引用校验测试。
 *
 * @author leolu
 */
class DefaultArchitectureReviewServiceTest {

    private HealthReportService healthReportService;
    private GitChurnAnalyzer gitChurnAnalyzer;
    private ArchitectureReviewModel model;
    private DefaultArchitectureReviewService service;

    @BeforeEach
    void setUp() {
        healthReportService = mock(HealthReportService.class);
        gitChurnAnalyzer = mock(GitChurnAnalyzer.class);
        model = mock(ArchitectureReviewModel.class);
        service = new DefaultArchitectureReviewService(healthReportService, gitChurnAnalyzer, model);
        when(healthReportService.generate("project-a")).thenReturn(report());
        when(gitChurnAnalyzer.topHotspots("project-a", 5)).thenReturn(List.of(
                new HotspotMetric("src/Foo.java", 12, 3, 8.5, 21.8)));
        when(model.modelId()).thenReturn("OLLAMA / qwen3:8b");
    }

    @Test
    void completedReviewKeepsOnlyKnownEvidenceCitations() {
        when(model.available()).thenReturn(true);
        when(model.review(any(ArchitectureReviewInput.class))).thenReturn(new ArchitectureModelResponse(
                List.of("复杂度和变更集中在同一位置。"),
                List.of(new ArchitectureReviewCandidate(
                        1, "深化入口模块", "src/Foo.java", "变化放大", "收敛接口", "提升局部性",
                        "中", "兼容风险", "U1/U2/U4", List.of("ARCH-CC-1", "UNKNOWN"))),
                List.of()));

        var result = service.review("project-a");

        assertThat(result.status()).isEqualTo(ArchitectureReviewStatus.COMPLETED);
        assertThat(result.candidates()).hasSize(1);
        assertThat(result.candidates().getFirst().citations()).containsExactly("ARCH-CC-1");
        assertThat(result.missingInfo()).anyMatch(item -> item.contains("未知引用"));
        assertThat(result.evidence()).extracting("citationId")
                .contains("ARCH-HEALTH", "ARCH-CC-1", "ARCH-COUPLING-1", "ARCH-CYCLE-1", "ARCH-HOTSPOT-1");
    }

    @Test
    void disabledModelReturnsFactsWithoutInventingCandidates() {
        when(model.available()).thenReturn(false);

        var result = service.review("project-a");

        assertThat(result.status()).isEqualTo(ArchitectureReviewStatus.DISABLED);
        assertThat(result.candidates()).isEmpty();
        assertThat(result.evidence()).isNotEmpty();
    }

    private static HealthReport report() {
        return new HealthReport(
                "project-a", "/repo", "2026-08-10T10:00:00Z", 72,
                100, 20, 140, 0, 1, 2, 0,
                1, 1, 1, 3, 4, 20,
                List.of(new ComplexityMetric("a.Foo#run()", "src/Foo.java", 18, "METHOD", 14)),
                List.of(new CouplingMetric("a.Foo", 2, 8, 0.8)),
                List.of(new PackageCycle(List.of("a", "b"))));
    }
}
