package com.repograph.metrics;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@link GitChurnAnalyzer} 单元测试。
 *
 * <p>使用包内可见的 {@code gitFileChurn()} 方法覆盖，完全隔离真实 Git 进程。
 *
 * @author leolu
 * @since 0.7.0
 */
@ExtendWith(MockitoExtension.class)
class GitChurnAnalyzerTest {

    @Mock GraphQueryService graphQueryService;
    @Mock ComplexityAnalyzer complexityAnalyzer;

    private static final String PID = "proj-test";
    private static final String ROOT = "/project/root";

    // ── Test-double factory ───────────────────────────────────────────────────

    private GitChurnAnalyzer analyzerWith(Map<String, Integer> churn) {
        return new GitChurnAnalyzer(graphQueryService, complexityAnalyzer) {
            @Override Map<String, Integer> gitFileChurn(String projectRoot) { return churn; }
        };
    }

    private void stubProjectRoot() {
        when(graphQueryService.listProjects()).thenReturn(
                List.of(new ProjectInfo(PID, ROOT, 10L, "2024-01-01T00:00:00Z")));
    }

    private static ComplexityMetric ccMetric(String qn, String file, int cc) {
        return new ComplexityMetric(qn, file, 1, "METHOD", cc);
    }

    // ── No git data ───────────────────────────────────────────────────────────

    @Test
    void noProjectRoot_returnsEmpty() {
        when(graphQueryService.listProjects()).thenReturn(List.of());
        GitChurnAnalyzer analyzer = analyzerWith(Map.of("Foo.java", 10));

        assertThat(analyzer.topHotspots(PID, 10)).isEmpty();
    }

    @Test
    void emptyChurnMap_returnsEmpty() {
        stubProjectRoot();
        // No complexity stub needed — early return before calling complexityAnalyzer
        assertThat(analyzerWith(Map.of()).topHotspots(PID, 10)).isEmpty();
    }

    @Test
    void noComplexityData_returnsEmpty() {
        stubProjectRoot();
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(List.of());

        assertThat(analyzerWith(Map.of("src/Foo.java", 5)).topHotspots(PID, 10)).isEmpty();
    }

    // ── Basic hotspot computation ─────────────────────────────────────────────

    @Test
    void singleHotspot_scoreEqualsLnChurnTimesCC() {
        stubProjectRoot();
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(
                List.of(ccMetric("com.Foo#bar", "src/Foo.java", 8)));

        // churnCount=9: ln(10) ≈ 2.302, avgCC=8, score ≈ 18.42
        List<HotspotMetric> result = analyzerWith(Map.of("src/Foo.java", 9))
                .topHotspots(PID, 10);

        assertThat(result).hasSize(1);
        HotspotMetric h = result.get(0);
        assertThat(h.filePath()).isEqualTo("src/Foo.java");
        assertThat(h.churnCount()).isEqualTo(9);
        assertThat(h.avgComplexity()).isEqualTo(8.0);
        assertThat(h.hotspotScore()).isGreaterThan(18.0).isLessThan(19.0);
    }

    @Test
    void fileWithNoChurn_excluded() {
        stubProjectRoot();
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(List.of(
                ccMetric("com.A#x", "src/A.java", 10),
                ccMetric("com.B#y", "src/B.java", 10)));

        // Only A has churn
        List<HotspotMetric> result = analyzerWith(Map.of("src/A.java", 5))
                .topHotspots(PID, 10);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).filePath()).isEqualTo("src/A.java");
    }

    // ── Multiple methods per file ─────────────────────────────────────────────

    @Test
    void multipleMethodsSameFile_avgComplexityComputed() {
        stubProjectRoot();
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(List.of(
                ccMetric("com.Svc#a", "src/Svc.java", 4),
                ccMetric("com.Svc#b", "src/Svc.java", 8),
                ccMetric("com.Svc#c", "src/Svc.java", 6)));

        List<HotspotMetric> result = analyzerWith(Map.of("src/Svc.java", 10))
                .topHotspots(PID, 10);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).methodCount()).isEqualTo(3);
        assertThat(result.get(0).avgComplexity()).isEqualTo(6.0); // (4+8+6)/3
    }

    @Test
    void methodCountMatchesComplexityEntries() {
        stubProjectRoot();
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(List.of(
                ccMetric("com.X#a", "src/X.java", 3),
                ccMetric("com.X#b", "src/X.java", 5)));

        List<HotspotMetric> result = analyzerWith(Map.of("src/X.java", 3))
                .topHotspots(PID, 10);

        assertThat(result.get(0).methodCount()).isEqualTo(2);
    }

    // ── Ordering ──────────────────────────────────────────────────────────────

    @Test
    void hotspots_sortedByScoreDescending() {
        stubProjectRoot();
        // A: churn=100, CC=2  → score = ln(101)×2 ≈ 9.2
        // B: churn=5,   CC=20 → score = ln(6)×20  ≈ 35.8  (higher — fewer commits but more complex)
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(List.of(
                ccMetric("com.A#x", "src/A.java", 2),
                ccMetric("com.B#y", "src/B.java", 20)));

        List<HotspotMetric> result = analyzerWith(Map.of("src/A.java", 100, "src/B.java", 5))
                .topHotspots(PID, 10);

        assertThat(result).hasSize(2);
        assertThat(result.get(0).filePath()).isEqualTo("src/B.java");
        assertThat(result.get(1).filePath()).isEqualTo("src/A.java");
    }

    // ── Limit ─────────────────────────────────────────────────────────────────

    @Test
    void limitApplied() {
        stubProjectRoot();
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(List.of(
                ccMetric("A", "a.java", 5), ccMetric("B", "b.java", 5),
                ccMetric("C", "c.java", 5), ccMetric("D", "d.java", 5),
                ccMetric("E", "e.java", 5)));
        Map<String, Integer> churn = Map.of(
                "a.java", 1, "b.java", 2, "c.java", 3, "d.java", 4, "e.java", 5);

        List<HotspotMetric> result = analyzerWith(churn).topHotspots(PID, 3);

        assertThat(result).hasSize(3);
    }

    // ── Score precision ───────────────────────────────────────────────────────

    @Test
    void hotspotScore_roundedTo2Decimals() {
        stubProjectRoot();
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(
                List.of(ccMetric("com.X#a", "X.java", 7)));

        List<HotspotMetric> result = analyzerWith(Map.of("X.java", 42))
                .topHotspots(PID, 10);

        // Score should have at most 2 decimal places (tested by checking rounded string)
        String scoreStr = String.valueOf(result.get(0).hotspotScore());
        int dotIdx = scoreStr.indexOf('.');
        if (dotIdx >= 0) {
            assertThat(scoreStr.length() - dotIdx - 1).isLessThanOrEqualTo(2);
        }
    }

    @Test
    void avgComplexity_roundedTo2Decimals() {
        stubProjectRoot();
        // CC values: 3, 4 → avg = 3.5
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(List.of(
                ccMetric("com.X#a", "X.java", 3),
                ccMetric("com.X#b", "X.java", 4)));

        List<HotspotMetric> result = analyzerWith(Map.of("X.java", 10))
                .topHotspots(PID, 10);

        assertThat(result.get(0).avgComplexity()).isEqualTo(3.5);
    }

    // ── Path normalization ────────────────────────────────────────────────────

    @Test
    void forwardSlashPath_matchesGitOutput() {
        stubProjectRoot();
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(
                List.of(ccMetric("com.Foo#bar", "src/main/java/Foo.java", 6)));

        // git log outputs forward slashes (even on Windows for many clients)
        List<HotspotMetric> result = analyzerWith(Map.of("src/main/java/Foo.java", 15))
                .topHotspots(PID, 10);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).churnCount()).isEqualTo(15);
    }
}
