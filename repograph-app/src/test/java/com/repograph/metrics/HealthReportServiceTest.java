package com.repograph.metrics;

import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import com.repograph.core.graph.ProjectStats;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.vuln.VulnFinding;
import com.repograph.vuln.VulnStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * {@link HealthReportService} 单元测试，验证健康分计算逻辑和报告字段聚合。
 *
 * @author leolu
 * @since 0.6.0
 */
@ExtendWith(MockitoExtension.class)
class HealthReportServiceTest {

    @Mock VulnStore vulnStore;
    @Mock ComplexityAnalyzer complexityAnalyzer;
    @Mock CouplingAnalyzer couplingAnalyzer;
    @Mock PackageCycleDetector packageCycleDetector;
    @Mock GraphQueryService graphQueryService;
    @Mock GraphDiagnosticsService graphDiagnosticsService;

    HealthReportService service;

    private static final String PID = "proj-test";

    @BeforeEach
    void setUp() {
        service = new HealthReportService(
                vulnStore, complexityAnalyzer, couplingAnalyzer,
                packageCycleDetector, graphQueryService, graphDiagnosticsService);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static VulnFinding vuln(String severity, String status) {
        return new VulnFinding("id1", PID, "RULE", "CWE-1", severity, status,
                "unit1", "com.X#foo", "X.java", 10, "title", null, "2024-01-01T00:00:00Z");
    }

    private static ComplexityMetric cc(String qn, int complexity) {
        return new ComplexityMetric(qn, "Foo.java", 1, "METHOD", complexity);
    }

    private static CouplingMetric coupling(String cls, int fanIn, int fanOut, double instability) {
        return new CouplingMetric(cls, fanIn, fanOut, instability);
    }

    private void defaultStubs() {
        when(graphQueryService.projectStats(PID))
                .thenReturn(new ProjectStats(PID, "", 100L, 20L, 250L, 0L, 0L,
                        java.util.Map.of(), java.util.Map.of(), java.util.Map.of(), java.util.Map.of()));
        when(graphQueryService.listProjects()).thenReturn(List.of(
                new ProjectInfo(PID, "/home/user/proj", 100L, "2024-01-01T00:00:00Z")));
        when(vulnStore.list(anyString(), any(), any())).thenReturn(List.of());
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(List.of());
        when(couplingAnalyzer.compute(PID)).thenReturn(List.of());
        when(packageCycleDetector.findCycles(PID)).thenReturn(List.of());
        when(graphDiagnosticsService.findDeadCode(PID)).thenReturn(List.of());
        when(graphDiagnosticsService.findTestGaps(PID)).thenReturn(List.of());
        when(graphDiagnosticsService.listScanTargets(PID)).thenReturn(List.of());
    }

    // ── Perfect score ─────────────────────────────────────────────────────────

    @Test
    void perfectScore_noIssues_returns100() {
        defaultStubs();
        HealthReport r = service.generate(PID);
        assertThat(r.healthScore()).isEqualTo(100);
    }

    // ── Vuln deductions ───────────────────────────────────────────────────────

    @Test
    void highVuln_deducts10PerVuln() {
        defaultStubs();
        when(vulnStore.list(anyString(), any(), any()))
                .thenReturn(List.of(vuln("HIGH", "SUSPECTED"), vuln("HIGH", "CONFIRMED")));

        HealthReport r = service.generate(PID);
        assertThat(r.vulnHigh()).isEqualTo(2);
        assertThat(r.healthScore()).isEqualTo(80); // 100 - 2×10
    }

    @Test
    void dismissedVulns_notCounted() {
        defaultStubs();
        when(vulnStore.list(anyString(), any(), any()))
                .thenReturn(List.of(vuln("HIGH", "DISMISSED"), vuln("HIGH", "FIXED")));

        HealthReport r = service.generate(PID);
        assertThat(r.vulnHigh()).isEqualTo(0);
        assertThat(r.healthScore()).isEqualTo(100);
    }

    @Test
    void mediumVuln_deducts5PerVuln() {
        defaultStubs();
        when(vulnStore.list(anyString(), any(), any()))
                .thenReturn(List.of(vuln("MEDIUM", "SUSPECTED")));

        HealthReport r = service.generate(PID);
        assertThat(r.vulnMedium()).isEqualTo(1);
        assertThat(r.healthScore()).isEqualTo(95);
    }

    @Test
    void vulnDeductionsCappedPerSeverity() {
        defaultStubs();
        // 5 HIGH vulns × 10 = 50, but capped at 40
        List<VulnFinding> many = List.of(
                vuln("HIGH", "SUSPECTED"), vuln("HIGH", "SUSPECTED"), vuln("HIGH", "SUSPECTED"),
                vuln("HIGH", "SUSPECTED"), vuln("HIGH", "SUSPECTED"));
        when(vulnStore.list(anyString(), any(), any())).thenReturn(many);

        HealthReport r = service.generate(PID);
        assertThat(r.healthScore()).isEqualTo(60); // 100 - 40 cap
    }

    // ── Complexity deductions ─────────────────────────────────────────────────

    @Test
    void highComplexity_twoMethodsOver10_deducts4() {
        defaultStubs();
        when(complexityAnalyzer.topComplex(PID, 10_000))
                .thenReturn(List.of(cc("com.A#x", 15), cc("com.B#y", 12), cc("com.C#z", 7)));

        HealthReport r = service.generate(PID);
        assertThat(r.highComplexityMethods()).isEqualTo(2);
        assertThat(r.healthScore()).isEqualTo(96); // 100 - 2×2
    }

    @Test
    void topComplexMethods_limitedTo5() {
        defaultStubs();
        when(complexityAnalyzer.topComplex(PID, 10_000))
                .thenReturn(List.of(
                        cc("A", 20), cc("B", 18), cc("C", 15),
                        cc("D", 14), cc("E", 13), cc("F", 12)));

        HealthReport r = service.generate(PID);
        assertThat(r.topComplexMethods()).hasSize(5);
        assertThat(r.topComplexMethods().get(0).complexity()).isEqualTo(20);
    }

    // ── Coupling deductions ───────────────────────────────────────────────────

    @Test
    void highInstability_deducts1PerClass() {
        defaultStubs();
        when(couplingAnalyzer.compute(PID))
                .thenReturn(List.of(
                        coupling("com.A", 1, 9, 0.9),   // 0.9 > 0.8 → counts
                        coupling("com.B", 2, 8, 0.8),   // 0.8 NOT > 0.8 → excluded
                        coupling("com.C", 5, 5, 0.5)));  // 0.5 → excluded

        HealthReport r = service.generate(PID);
        assertThat(r.highInstabilityClasses()).isEqualTo(1);
        assertThat(r.healthScore()).isEqualTo(99); // 100 - 1×1
    }

    @Test
    void topInstableCouplings_sortedByInstabilityDesc() {
        defaultStubs();
        when(couplingAnalyzer.compute(PID))
                .thenReturn(List.of(
                        coupling("com.Low", 8, 2, 0.2),
                        coupling("com.High", 1, 9, 0.9),
                        coupling("com.Mid", 3, 7, 0.7)));

        HealthReport r = service.generate(PID);
        assertThat(r.topInstableCouplings().get(0).classQualifiedName()).isEqualTo("com.High");
    }

    // ── Package cycles ────────────────────────────────────────────────────────

    @Test
    void packageCycles_twoThreePackage_deducts20() {
        defaultStubs();
        when(packageCycleDetector.findCycles(PID))
                .thenReturn(List.of(
                        new PackageCycle(List.of("a", "b", "c")),
                        new PackageCycle(List.of("x", "y"))));

        HealthReport r = service.generate(PID);
        assertThat(r.packageCycles()).isEqualTo(2);
        assertThat(r.healthScore()).isEqualTo(80); // 100 - 2×10
    }

    @Test
    void packageCyclesDeductionCappedAt30() {
        defaultStubs();
        // 4 cycles × 10 = 40, capped at 30
        when(packageCycleDetector.findCycles(PID))
                .thenReturn(List.of(
                        new PackageCycle(List.of("a", "b")),
                        new PackageCycle(List.of("c", "d")),
                        new PackageCycle(List.of("e", "f")),
                        new PackageCycle(List.of("g", "h"))));

        HealthReport r = service.generate(PID);
        assertThat(r.healthScore()).isEqualTo(70); // 100 - 30 cap
    }

    // ── Test gap ──────────────────────────────────────────────────────────────

    @Test
    void testGapOver70Percent_deducts15() {
        defaultStubs();
        List<CodeUnit> tenMethods = List.of(
                mockUnit(), mockUnit(), mockUnit(), mockUnit(), mockUnit(),
                mockUnit(), mockUnit(), mockUnit(), mockUnit(), mockUnit());
        List<CodeUnit> eightGaps = tenMethods.subList(0, 8);
        when(graphDiagnosticsService.listScanTargets(PID)).thenReturn(tenMethods); // 10 methods
        when(graphDiagnosticsService.findTestGaps(PID)).thenReturn(eightGaps);    // 80% gap

        HealthReport r = service.generate(PID);
        assertThat(r.testGapCount()).isEqualTo(8);
        assertThat(r.totalProductionMethods()).isEqualTo(10);
        assertThat(r.healthScore()).isEqualTo(85); // 100 - 15
    }

    @Test
    void testGapBetween50And70Percent_deducts10() {
        defaultStubs();
        List<CodeUnit> tenMethods = List.of(
                mockUnit(), mockUnit(), mockUnit(), mockUnit(), mockUnit(),
                mockUnit(), mockUnit(), mockUnit(), mockUnit(), mockUnit());
        when(graphDiagnosticsService.listScanTargets(PID)).thenReturn(tenMethods);
        when(graphDiagnosticsService.findTestGaps(PID)).thenReturn(tenMethods.subList(0, 6)); // 60% gap

        HealthReport r = service.generate(PID);
        assertThat(r.healthScore()).isEqualTo(90); // 100 - 10
    }

    @Test
    void noProductionMethods_noGapDeduction() {
        defaultStubs();
        when(graphDiagnosticsService.listScanTargets(PID)).thenReturn(List.of());
        when(graphDiagnosticsService.findTestGaps(PID)).thenReturn(List.of());

        HealthReport r = service.generate(PID);
        assertThat(r.healthScore()).isEqualTo(100);
    }

    // ── Aggregate fields ──────────────────────────────────────────────────────

    @Test
    void projectRoot_resolvedFromListProjects() {
        defaultStubs();
        HealthReport r = service.generate(PID);
        assertThat(r.projectRoot()).isEqualTo("/home/user/proj");
    }

    @Test
    void stats_propagatedFromProjectStats() {
        defaultStubs();
        HealthReport r = service.generate(PID);
        assertThat(r.totalUnits()).isEqualTo(100L);
        assertThat(r.totalFiles()).isEqualTo(20L);
        assertThat(r.totalEdges()).isEqualTo(250L);
    }

    @Test
    void packageCycleList_cappedAt10() {
        defaultStubs();
        List<PackageCycle> manyCycles = List.of(
                new PackageCycle(List.of("a", "b")), new PackageCycle(List.of("c", "d")),
                new PackageCycle(List.of("e", "f")), new PackageCycle(List.of("g", "h")),
                new PackageCycle(List.of("i", "j")), new PackageCycle(List.of("k", "l")),
                new PackageCycle(List.of("m", "n")), new PackageCycle(List.of("o", "p")),
                new PackageCycle(List.of("q", "r")), new PackageCycle(List.of("s", "t")),
                new PackageCycle(List.of("u", "v")));
        when(packageCycleDetector.findCycles(PID)).thenReturn(manyCycles);

        HealthReport r = service.generate(PID);
        assertThat(r.packageCycles()).isEqualTo(11);
        assertThat(r.packageCycleList()).hasSize(10);
    }

    @Test
    void scoreFloorIsZero() {
        defaultStubs();
        // Massive deductions shouldn't go negative
        List<VulnFinding> manyHigh = List.of(
                vuln("HIGH", "SUSPECTED"), vuln("HIGH", "SUSPECTED"),
                vuln("HIGH", "SUSPECTED"), vuln("HIGH", "SUSPECTED"),
                vuln("HIGH", "SUSPECTED"));
        when(vulnStore.list(anyString(), any(), any())).thenReturn(manyHigh);
        when(packageCycleDetector.findCycles(PID)).thenReturn(List.of(
                new PackageCycle(List.of("a", "b")), new PackageCycle(List.of("c", "d")),
                new PackageCycle(List.of("e", "f")), new PackageCycle(List.of("g", "h"))));
        when(complexityAnalyzer.topComplex(PID, 10_000)).thenReturn(List.of(
                cc("A", 15), cc("B", 14), cc("C", 13), cc("D", 12),
                cc("E", 11), cc("F", 10), cc("G", 9), cc("H", 8)));
        List<CodeUnit> tenMethods = List.of(
                mockUnit(), mockUnit(), mockUnit(), mockUnit(), mockUnit(),
                mockUnit(), mockUnit(), mockUnit(), mockUnit(), mockUnit());
        when(graphDiagnosticsService.listScanTargets(PID)).thenReturn(tenMethods);
        when(graphDiagnosticsService.findTestGaps(PID)).thenReturn(tenMethods);

        HealthReport r = service.generate(PID);
        assertThat(r.healthScore()).isGreaterThanOrEqualTo(0);
    }

    // ── computeScore static method ────────────────────────────────────────────

    @Test
    void computeScore_allZero_returns100() {
        assertThat(HealthReportService.computeScore(0, 0, 0, 0, 0, 0, 0, 0, 0, 0)).isEqualTo(100);
    }

    @Test
    void computeScore_oneCriticalVuln_deducts15() {
        assertThat(HealthReportService.computeScore(1, 0, 0, 0, 0, 0, 0, 0, 0, 0)).isEqualTo(85);
    }

    @Test
    void computeScore_deadCodeOver10Percent_deducts5() {
        // 2 dead code, 10 production methods = 20% dead → deduct 5
        assertThat(HealthReportService.computeScore(0, 0, 0, 0, 0, 0, 0, 0, 10, 2)).isEqualTo(95);
    }

    @Test
    void computeScore_scoreFloorIsZero() {
        // Extreme inputs
        assertThat(HealthReportService.computeScore(100, 100, 100, 100, 10, 50, 20, 100, 1, 1))
                .isGreaterThanOrEqualTo(0);
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    private static CodeUnit mockUnit() {
        return new CodeUnit("id", CodeUnitKind.METHOD, "java",
                "com.example.Foo#doWork", "doWork", "/src/Foo.java",
                1, 50, "public void doWork() {}", "public void doWork()",
                List.of(), "com.example.Foo", java.util.Map.of());
    }

    /** Stub GraphQueryService for tests that don't use Mockito's @Mock. */
    @SuppressWarnings("unused")
    private static GraphQueryService stubGraph() {
        return new GraphQueryService() {
            @Override public List<CodeUnit> findCallers(String q, int d, String p) { return List.of(); }
            @Override public Set<CodeUnit> impactAnalysis(String q, String p) { return Set.of(); }
            @Override public List<CodeUnit> findCallees(String q, int d, String p) { return List.of(); }
            @Override public List<CodeUnit> findSubTypes(String q, String p) { return List.of(); }
            @Override public List<CodeUnit> findSymbols(String q, String p, int l) { return List.of(); }
            @Override public Optional<CodeUnit> findSymbol(String q, String p) { return Optional.empty(); }
            @Override public List<ProjectInfo> listProjects() { return List.of(); }
            @Override public List<CodeUnit> findEntryPoints(String p) { return List.of(); }
            @Override public ProjectStats projectStats(String p) {
                return new ProjectStats(p, "", 0L, 0L, 0L, 0L, 0L,
                        java.util.Map.of(), java.util.Map.of(), java.util.Map.of(), java.util.Map.of());
            }
        };
    }
}
