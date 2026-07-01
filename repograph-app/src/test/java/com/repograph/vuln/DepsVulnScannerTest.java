package com.repograph.vuln;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.sbom.SbomService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link DepsVulnScanner} 扫描链路：SBOM 解析 → Advisory 版本区间匹配 → finding 写入。
 *
 * <p>使用 Mockito mock {@link SbomService}，注入预设 CycloneDX JSON；
 * {@link AdvisoryStore} 和 {@link VulnStore} 使用临时 SQLite 文件，无需外部服务。
 *
 * @author leolu
 * @since 0.5.0
 */
class DepsVulnScannerTest {

    @TempDir
    Path tmpDir;

    private SbomService sbomService;
    private AdvisoryStore advisoryStore;
    private VulnStore vulnStore;
    private DepsVulnScanner scanner;

    private static final String PROJECT_ID = "test-project-01";

    @BeforeEach
    void setUp() {
        sbomService   = mock(SbomService.class);
        advisoryStore = new AdvisoryStore(tmpDir.resolve("adv.db").toString(), new ObjectMapper());
        vulnStore     = new VulnStore(tmpDir.resolve("vuln.db").toString());
        scanner       = new DepsVulnScanner(sbomService, advisoryStore, vulnStore, new ObjectMapper());
    }

    // ── 1. 受影响版本命中 advisory ────────────────────────────────────────────

    @Test
    void affected_version_in_range_creates_finding() throws Exception {
        // log4j-core 2.14.0 在 bundled advisory [2.0-beta9, 2.15.0) 区间内
        when(sbomService.generateCycloneDx(any())).thenReturn(cycloneDx(
                component("org.apache.logging.log4j", "log4j-core", "2.14.0", "required")));

        DepsVulnScanner.ScanSummary summary = scanner.scan(PROJECT_ID, Path.of("/tmp/project"));

        assertThat(summary.scannedComponents()).isEqualTo(1);
        assertThat(summary.newFindings()).isGreaterThanOrEqualTo(1);

        List<VulnFinding> findings = vulnStore.list(PROJECT_ID, null, null);
        assertThat(findings).isNotEmpty();
        assertThat(findings).allMatch(f -> "log4j-core".equals(f.qualifiedName().split(":")[1]));
        assertThat(findings).allMatch(f -> "DEP_VULNERABILITY".equals(f.ruleId()));
        assertThat(findings).allMatch(f -> VulnFinding.SUSPECTED.equals(f.status()));
    }

    // ── 2. 已修复版本不产生 finding ────────────────────────────────────────────

    @Test
    void fixed_version_no_finding() throws Exception {
        // log4j-core 2.17.1 高于全部 bundled advisory 的 fixed 版本，不受影响
        when(sbomService.generateCycloneDx(any())).thenReturn(cycloneDx(
                component("org.apache.logging.log4j", "log4j-core", "2.17.1", "required")));

        DepsVulnScanner.ScanSummary summary = scanner.scan(PROJECT_ID, Path.of("/tmp/project"));

        assertThat(summary.scannedComponents()).isEqualTo(1);
        assertThat(summary.newFindings()).isEqualTo(0);
        assertThat(vulnStore.list(PROJECT_ID, null, null)).isEmpty();
    }

    // ── 3. scope=excluded 的组件跳过 ─────────────────────────────────────────

    @Test
    void excluded_scope_skipped() throws Exception {
        // struts2-core 2.3.20 版本在受影响区间内，但 scope=excluded 应跳过
        when(sbomService.generateCycloneDx(any())).thenReturn(cycloneDx(
                component("org.apache.struts", "struts2-core", "2.3.20", "excluded")));

        DepsVulnScanner.ScanSummary summary = scanner.scan(PROJECT_ID, Path.of("/tmp/project"));

        // scannedComponents 是解析出的总数（含 excluded）
        assertThat(summary.scannedComponents()).isEqualTo(1);
        assertThat(summary.newFindings()).isEqualTo(0);
        assertThat(vulnStore.list(PROJECT_ID, null, null)).isEmpty();
    }

    // ── 4. SBOM 生成失败容错 ──────────────────────────────────────────────────

    @Test
    void sbom_exception_returns_zero_summary() {
        when(sbomService.generateCycloneDx(any())).thenThrow(new RuntimeException("no pom.xml"));

        DepsVulnScanner.ScanSummary summary = scanner.scan(PROJECT_ID, Path.of("/tmp/project"));

        assertThat(summary.scannedComponents()).isEqualTo(0);
        assertThat(summary.newFindings()).isEqualTo(0);
        assertThat(vulnStore.list(PROJECT_ID, null, null)).isEmpty();
    }

    // ── 5. 无 Advisory 的组件不产生 finding ──────────────────────────────────

    @Test
    void no_advisory_for_component_no_finding() throws Exception {
        when(sbomService.generateCycloneDx(any())).thenReturn(cycloneDx(
                component("com.example", "mylib", "1.0.0", "required")));

        DepsVulnScanner.ScanSummary summary = scanner.scan(PROJECT_ID, Path.of("/tmp/project"));

        assertThat(summary.scannedComponents()).isEqualTo(1);
        assertThat(summary.newFindings()).isEqualTo(0);
        assertThat(vulnStore.list(PROJECT_ID, null, null)).isEmpty();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static String cycloneDx(String... componentJsons) {
        return """
                {
                  "components": [
                """ + String.join(",\n", componentJsons) + """
                  ]
                }
                """;
    }

    private static String component(String group, String name, String version, String scope) {
        return String.format(
                """
                        {"group":"%s","name":"%s","version":"%s","scope":"%s"}""",
                group, name, version, scope);
    }
}
