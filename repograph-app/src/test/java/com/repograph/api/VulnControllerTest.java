package com.repograph.api;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.vuln.CodeVulnScanner;
import com.repograph.vuln.DepsVulnScanner;
import com.repograph.vuln.PreciseTaintScanService;
import com.repograph.vuln.TaintVulnScanner;
import com.repograph.vuln.VulnFinding;
import com.repograph.vuln.VulnStore;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link VulnController} Web 层测试，覆盖漏洞扫描、列表、状态更新、影响面和报告端点。
 *
 * @author leolu
 * @since 0.5.0
 */
@WebMvcTest(VulnController.class)
class VulnControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    CodeVulnScanner scanner;

    @MockitoBean
    DepsVulnScanner depsScanner;

    @MockitoBean
    TaintVulnScanner taintScanner;

    @MockitoBean
    PreciseTaintScanService preciseTaintScanService;

    @MockitoBean
    VulnStore vulnStore;

    @MockitoBean
    GraphQueryService graphQueryService;

    // ── scan/code ─────────────────────────────────────────────────────────────

    @Test
    void scanCode_ok() throws Exception {
        when(scanner.scan("p1")).thenReturn(new CodeVulnScanner.ScanSummary(42, 3));
        mvc.perform(post("/api/v1/vulns/scan/code").param("projectId", "p1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scannedUnits").value(42))
                .andExpect(jsonPath("$.newFindings").value(3));
    }

    @Test
    void scanCode_missing_projectId_returns_400() throws Exception {
        mvc.perform(post("/api/v1/vulns/scan/code"))
                .andExpect(status().isBadRequest());
    }

    // ── scan/deps ─────────────────────────────────────────────────────────────

    @Test
    void scanDeps_ok() throws Exception {
        when(depsScanner.scan(eq("p1"), any(Path.class)))
                .thenReturn(new DepsVulnScanner.ScanSummary(10, 2));
        mvc.perform(post("/api/v1/vulns/scan/deps")
                        .param("projectId", "p1")
                        .param("projectRoot", "/tmp/myproject"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scannedComponents").value(10))
                .andExpect(jsonPath("$.newFindings").value(2));
    }

    @Test
    void scanDeps_missing_projectRoot_returns_400() throws Exception {
        mvc.perform(post("/api/v1/vulns/scan/deps").param("projectId", "p1"))
                .andExpect(status().isBadRequest());
    }

    // ── list ──────────────────────────────────────────────────────────────────

    @Test
    void list_returns_findings() throws Exception {
        when(vulnStore.list("p1", null, null)).thenReturn(List.of(finding("id1")));
        mvc.perform(get("/api/v1/vulns").param("projectId", "p1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].ruleId").value("SQL_INJECTION"))
                .andExpect(jsonPath("$[0].severity").value("HIGH"));
    }

    @Test
    void list_with_severity_filter() throws Exception {
        when(vulnStore.list("p1", "HIGH", null)).thenReturn(List.of(finding("id2")));
        mvc.perform(get("/api/v1/vulns").param("projectId", "p1").param("severity", "HIGH"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void list_empty() throws Exception {
        when(vulnStore.list("p1", null, null)).thenReturn(List.of());
        mvc.perform(get("/api/v1/vulns").param("projectId", "p1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ── updateStatus ──────────────────────────────────────────────────────────

    @Test
    void updateStatus_valid_returns_200() throws Exception {
        when(vulnStore.updateStatus("id1", "CONFIRMED")).thenReturn(true);
        mvc.perform(put("/api/v1/vulns/id1/status").param("status", "CONFIRMED"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("id1"))
                .andExpect(jsonPath("$.status").value("CONFIRMED"));
    }

    @Test
    void updateStatus_invalid_status_returns_400() throws Exception {
        mvc.perform(put("/api/v1/vulns/id1/status").param("status", "BOGUS"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.valid").exists());
    }

    @Test
    void updateStatus_not_found_returns_404() throws Exception {
        when(vulnStore.updateStatus("nonexistent", "FIXED")).thenReturn(false);
        mvc.perform(put("/api/v1/vulns/nonexistent/status").param("status", "FIXED"))
                .andExpect(status().isNotFound());
    }

    // ── impact ────────────────────────────────────────────────────────────────

    @Test
    void impact_found_returns_200() throws Exception {
        VulnFinding f = finding("id1");
        CodeUnit caller = new CodeUnit("c1", CodeUnitKind.METHOD, "java",
                "com.Bar#call()", "call", "Bar.java", 1, 5, "", "void call()", List.of(), null, Map.of());
        when(vulnStore.findById("id1")).thenReturn(Optional.of(f));
        when(graphQueryService.impactAnalysis("com.Foo#bar()", "p1")).thenReturn(Set.of(caller));
        mvc.perform(get("/api/v1/vulns/id1/impact"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].qualifiedName").value("com.Bar#call()"));
    }

    @Test
    void impact_not_found_returns_404() throws Exception {
        when(vulnStore.findById("missing")).thenReturn(Optional.empty());
        mvc.perform(get("/api/v1/vulns/missing/impact"))
                .andExpect(status().isNotFound());
    }

    @Test
    void impact_no_callers_returns_empty_list() throws Exception {
        when(vulnStore.findById("id1")).thenReturn(Optional.of(finding("id1")));
        when(graphQueryService.impactAnalysis("com.Foo#bar()", "p1")).thenReturn(Set.of());
        mvc.perform(get("/api/v1/vulns/id1/impact"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ── report ────────────────────────────────────────────────────────────────

    @Test
    void report_returns_summary() throws Exception {
        VulnFinding f = finding("id1");
        when(vulnStore.list("p1", null, null)).thenReturn(List.of(f));
        when(vulnStore.list("p1", null, VulnFinding.CONFIRMED)).thenReturn(List.of());
        mvc.perform(get("/api/v1/vulns/report/p1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").value("p1"))
                .andExpect(jsonPath("$.totalFindings").value(1))
                .andExpect(jsonPath("$.bySeverity.HIGH").value(1))
                .andExpect(jsonPath("$.byStatus.SUSPECTED").value(1));
    }

    @Test
    void report_empty_project() throws Exception {
        when(vulnStore.list("empty", null, null)).thenReturn(List.of());
        when(vulnStore.list("empty", null, VulnFinding.CONFIRMED)).thenReturn(List.of());
        mvc.perform(get("/api/v1/vulns/report/empty"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalFindings").value(0));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static VulnFinding finding(String id) {
        return new VulnFinding(
                id, "p1", "SQL_INJECTION", "CWE-89", "HIGH",
                "SUSPECTED", "uid-" + id, "com.Foo#bar()", "Foo.java",
                10, "SQL注入风险", "检测到字符串拼接", "2025-01-01T00:00:00Z");
    }
}
