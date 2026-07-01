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
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link MetricsController} 单元测试，验证圈复杂度和类耦合度查询端点。
 *
 * @author leolu
 * @since 0.6.0
 */
@WebMvcTest(MetricsController.class)
class MetricsControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    ComplexityAnalyzer complexityAnalyzer;

    @MockBean
    CouplingAnalyzer couplingAnalyzer;

    @MockBean
    PackageCycleDetector cycleDetector;

    @MockBean
    HealthReportService healthReportService;

    @MockBean
    GitChurnAnalyzer gitChurnAnalyzer;

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static ComplexityMetric ccMetric(String qn, int cc) {
        return new ComplexityMetric(qn, "src/main/java/Foo.java", 10, "METHOD", cc);
    }

    private static CouplingMetric coupling(String cls, int fanOut, int fanIn) {
        double i = (fanOut + fanIn) == 0 ? 0 : (double) fanOut / (fanOut + fanIn);
        return new CouplingMetric(cls, fanIn, fanOut, Math.round(i * 1000.0) / 1000.0);
    }

    // ── GET /api/v1/metrics/complexity ────────────────────────────────────────

    @Test
    void complexity_returnsMetricList() throws Exception {
        when(complexityAnalyzer.topComplex("proj-a", 20))
                .thenReturn(List.of(
                        ccMetric("com.example.Foo#doWork", 12),
                        ccMetric("com.example.Bar#process", 7)));

        mvc.perform(get("/api/v1/metrics/complexity").param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].qualifiedName").value("com.example.Foo#doWork"))
                .andExpect(jsonPath("$[0].complexity").value(12));
    }

    @Test
    void complexity_emptyResult_returnsEmptyArray() throws Exception {
        when(complexityAnalyzer.topComplex("proj-empty", 20)).thenReturn(List.of());

        mvc.perform(get("/api/v1/metrics/complexity").param("projectId", "proj-empty"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void complexity_customLimit_cappedAt100() throws Exception {
        when(complexityAnalyzer.topComplex("proj-a", 100)).thenReturn(List.of());

        mvc.perform(get("/api/v1/metrics/complexity")
                        .param("projectId", "proj-a")
                        .param("limit", "200"))
                .andExpect(status().isOk());
    }

    @Test
    void complexity_customLimit_passed() throws Exception {
        when(complexityAnalyzer.topComplex("proj-a", 5))
                .thenReturn(List.of(ccMetric("com.example.Foo#bar", 8)));

        mvc.perform(get("/api/v1/metrics/complexity")
                        .param("projectId", "proj-a")
                        .param("limit", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void complexity_responseContainsAllFields() throws Exception {
        when(complexityAnalyzer.topComplex("proj-a", 20))
                .thenReturn(List.of(new ComplexityMetric(
                        "com.example.OrderService#placeOrder",
                        "src/main/java/OrderService.java",
                        42, "METHOD", 15)));

        mvc.perform(get("/api/v1/metrics/complexity").param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].qualifiedName").value("com.example.OrderService#placeOrder"))
                .andExpect(jsonPath("$[0].filePath").value("src/main/java/OrderService.java"))
                .andExpect(jsonPath("$[0].startLine").value(42))
                .andExpect(jsonPath("$[0].kind").value("METHOD"))
                .andExpect(jsonPath("$[0].complexity").value(15));
    }

    // ── GET /api/v1/metrics/coupling ─────────────────────────────────────────

    @Test
    void coupling_defaultSortFanout_returnsList() throws Exception {
        when(couplingAnalyzer.topByFanOut("proj-a", 20))
                .thenReturn(List.of(
                        coupling("com.example.Service", 8, 3),
                        coupling("com.example.Repo", 4, 6)));

        mvc.perform(get("/api/v1/metrics/coupling").param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].classQualifiedName").value("com.example.Service"))
                .andExpect(jsonPath("$[0].fanOut").value(8))
                .andExpect(jsonPath("$[0].fanIn").value(3));
    }

    @Test
    void coupling_sortFanin_callsTopByFanIn() throws Exception {
        when(couplingAnalyzer.topByFanIn("proj-a", 20))
                .thenReturn(List.of(coupling("com.example.Core", 2, 12)));

        mvc.perform(get("/api/v1/metrics/coupling")
                        .param("projectId", "proj-a")
                        .param("sort", "fanin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].fanIn").value(12));
    }

    @Test
    void coupling_emptyResult_returnsEmptyArray() throws Exception {
        when(couplingAnalyzer.topByFanOut("proj-empty", 20)).thenReturn(List.of());

        mvc.perform(get("/api/v1/metrics/coupling").param("projectId", "proj-empty"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void coupling_responseContainsInstability() throws Exception {
        when(couplingAnalyzer.topByFanOut("proj-a", 20))
                .thenReturn(List.of(new CouplingMetric("com.example.X", 3, 7, 0.7)));

        mvc.perform(get("/api/v1/metrics/coupling").param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].instability").value(0.7));
    }

    @Test
    void coupling_limitCappedAt100() throws Exception {
        when(couplingAnalyzer.topByFanOut("proj-a", 100)).thenReturn(List.of());

        mvc.perform(get("/api/v1/metrics/coupling")
                        .param("projectId", "proj-a")
                        .param("limit", "999"))
                .andExpect(status().isOk());
    }

    // ── GET /api/v1/metrics/cycles ────────────────────────────────────────────

    @Test
    void cycles_returnsCycleList() throws Exception {
        when(cycleDetector.findCycles("proj-a"))
                .thenReturn(List.of(
                        new PackageCycle(List.of("com.a", "com.b", "com.c")),
                        new PackageCycle(List.of("com.x", "com.y"))));

        mvc.perform(get("/api/v1/metrics/cycles").param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].packages.length()").value(3))
                .andExpect(jsonPath("$[1].packages.length()").value(2));
    }

    @Test
    void cycles_noCycles_returnsEmptyArray() throws Exception {
        when(cycleDetector.findCycles("proj-clean")).thenReturn(List.of());

        mvc.perform(get("/api/v1/metrics/cycles").param("projectId", "proj-clean"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void cycles_responseContainsPackages() throws Exception {
        when(cycleDetector.findCycles("proj-a"))
                .thenReturn(List.of(new PackageCycle(List.of("com.service", "com.repo"))));

        mvc.perform(get("/api/v1/metrics/cycles").param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].packages").isArray());
    }

    // ── GET /api/v1/metrics/report ────────────────────────────────────────────

    @Test
    void report_returnsHealthReport() throws Exception {
        HealthReport report = new HealthReport(
                "proj-a", "/home/user/proj", "2024-01-01T00:00:00Z", 85,
                100L, 20L, 250L,
                0L, 1L, 2L, 0L,
                0, 3, 2, 5L, 40L, 80L,
                List.of(), List.of(), List.of());
        when(healthReportService.generate("proj-a")).thenReturn(report);

        mvc.perform(get("/api/v1/metrics/report").param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").value("proj-a"))
                .andExpect(jsonPath("$.healthScore").value(85))
                .andExpect(jsonPath("$.vulnHigh").value(1))
                .andExpect(jsonPath("$.packageCycles").value(0));
    }

    @Test
    void report_containsAllTopLevelFields() throws Exception {
        HealthReport report = new HealthReport(
                "proj-b", "/project/root", "2024-06-01T12:00:00Z", 92,
                50L, 10L, 120L,
                0L, 0L, 1L, 3L,
                1, 0, 1, 0L, 25L, 50L,
                List.of(new ComplexityMetric("com.Foo#bar", "Foo.java", 5, "METHOD", 12)),
                List.of(new CouplingMetric("com.Service", 1, 9, 0.9)),
                List.of(new PackageCycle(List.of("com.a", "com.b"))));
        when(healthReportService.generate("proj-b")).thenReturn(report);

        mvc.perform(get("/api/v1/metrics/report").param("projectId", "proj-b"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.healthScore").value(92))
                .andExpect(jsonPath("$.totalUnits").value(50))
                .andExpect(jsonPath("$.topComplexMethods.length()").value(1))
                .andExpect(jsonPath("$.topInstableCouplings.length()").value(1))
                .andExpect(jsonPath("$.packageCycleList.length()").value(1));
    }

    // ── GET /api/v1/metrics/hotspots ──────────────────────────────────────────

    @Test
    void hotspots_returnsHotspotList() throws Exception {
        when(gitChurnAnalyzer.topHotspots("proj-a", 10))
                .thenReturn(List.of(
                        new HotspotMetric("src/Foo.java", 50, 3, 12.0, 46.8),
                        new HotspotMetric("src/Bar.java", 20, 2, 8.0, 18.4)));

        mvc.perform(get("/api/v1/metrics/hotspots").param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].filePath").value("src/Foo.java"))
                .andExpect(jsonPath("$[0].churnCount").value(50))
                .andExpect(jsonPath("$[0].hotspotScore").value(46.8));
    }

    @Test
    void hotspots_noGitHistory_returnsEmptyArray() throws Exception {
        when(gitChurnAnalyzer.topHotspots("proj-clean", 10)).thenReturn(List.of());

        mvc.perform(get("/api/v1/metrics/hotspots").param("projectId", "proj-clean"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void hotspots_limitCappedAt50() throws Exception {
        when(gitChurnAnalyzer.topHotspots("proj-a", 50)).thenReturn(List.of());

        mvc.perform(get("/api/v1/metrics/hotspots")
                        .param("projectId", "proj-a")
                        .param("limit", "200"))
                .andExpect(status().isOk());
    }
}
