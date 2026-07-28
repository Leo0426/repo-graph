package com.repograph.asset;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.asset.AssetFileCategory;
import com.repograph.core.asset.AssetProfileOptions;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.asset.ProjectAssetProfile;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectStats;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.metrics.GitChurnAnalyzer;
import com.repograph.metrics.HotspotMetric;
import com.repograph.sbom.SbomService;
import com.repograph.vuln.VulnFinding;
import com.repograph.vuln.VulnStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@link DefaultAssetProfileService} 资产画像行为测试。
 *
 * @author leolu
 */
class DefaultAssetProfileServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void buildProfile_classifiesMixedProjectAndProducesRiskAwareScannerPlan() throws Exception {
        Files.createDirectories(tempDir.resolve("src/main/java"));
        Files.createDirectories(tempDir.resolve("src/test/java"));
        Files.createDirectories(tempDir.resolve("docs"));
        Files.createDirectories(tempDir.resolve("target/generated-sources"));
        Files.writeString(tempDir.resolve("src/main/java/App.java"), """
                @RestController
                class App {
                    void run(String input) throws Exception { Runtime.getRuntime().exec(input); }
                }
                """);
        Files.writeString(tempDir.resolve("src/main/java/UserMapper.java"), "@Mapper interface UserMapper {}");
        Files.writeString(tempDir.resolve("src/test/java/AppTest.java"), "class AppTest {}");
        Files.writeString(tempDir.resolve("docs/README.md"), "# Guide");
        Files.writeString(tempDir.resolve("target/generated-sources/Generated.java"), "class Generated {}");
        Files.write(tempDir.resolve("unknown.bin"), new byte[]{1, 2, 3});
        Files.writeString(tempDir.resolve("application.yml"), "password: ${DB_PASSWORD}");
        Files.writeString(tempDir.resolve("pom.xml"), "<project/>");

        GraphQueryService graph = mock(GraphQueryService.class);
        GraphDiagnosticsService diagnostics = mock(GraphDiagnosticsService.class);
        SbomService sbom = mock(SbomService.class);
        VulnStore vulnStore = mock(VulnStore.class);
        GitChurnAnalyzer churn = mock(GitChurnAnalyzer.class);
        when(graph.projectStats("project-1")).thenReturn(new ProjectStats(
                "project-1", tempDir.toString(), 8, 8, 2, 1, 1,
                Map.of(), Map.of("java", 4L), Map.of("spring", 1L), Map.of()));
        CodeUnit entry = unit("src/main/java/App.java", "@RestController class App {}", true);
        CodeUnit sink = unit("src/main/java/App.java", "Runtime.getRuntime().exec(input);", false);
        when(graph.findEntryPoints("project-1")).thenReturn(List.of(entry));
        when(diagnostics.listScanTargets("project-1")).thenReturn(List.of(sink));
        when(sbom.generateCycloneDx(tempDir)).thenReturn("""
                {"components":[{"group":"org.demo","name":"core","version":"1.2.3","scope":"required"}]}
                """);
        when(vulnStore.list("project-1", null, null)).thenReturn(List.of());
        when(churn.topHotspots("project-1", 10)).thenReturn(List.of());

        DefaultAssetProfileService service = new DefaultAssetProfileService(
                graph, diagnostics, sbom, new ObjectMapper(), vulnStore, churn);
        ProjectAssetProfile profile = service.build(asset(), AssetProfileOptions.defaults());

        assertThat(profile.categoryDistribution())
                .containsEntry(AssetFileCategory.BUSINESS.name(), 4L)
                .containsEntry(AssetFileCategory.TEST.name(), 1L)
                .containsEntry(AssetFileCategory.DOCUMENTATION.name(), 1L)
                .containsEntry(AssetFileCategory.GENERATED.name(), 1L)
                .containsEntry(AssetFileCategory.UNKNOWN.name(), 1L);
        assertThat(profile.files()).allMatch(file -> !file.reason().isBlank());
        assertThat(profile.frameworks()).contains("spring", "mybatis");
        assertThat(profile.buildSystems()).containsExactly("maven");
        assertThat(profile.dependencies()).singleElement()
                .satisfies(dep -> assertThat(dep.coordinate()).isEqualTo("org.demo:core"));
        assertThat(profile.riskSignals()).extracting(signal -> signal.type())
                .contains("PUBLIC_HTTP_ENTRY", "DANGEROUS_SINK", "SENSITIVE_CONFIG");
        assertThat(profile.scannerPlan())
                .filteredOn(item -> item.selected())
                .extracting(item -> item.scanner())
                .contains("REPOGRAPH_CODE", "REPOGRAPH_TAINT", "REPOGRAPH_PRECISE_TAINT",
                        "SEMGREP", "CODEQL", "DEPENDENCY_CVE")
                .doesNotContain("SLITHER");
    }

    @Test
    void buildProfile_appliesScannerOverridesWithoutHidingInapplicableReason() throws Exception {
        Files.writeString(tempDir.resolve("main.py"), "print('ok')");
        DefaultAssetProfileService service = emptyService();

        ProjectAssetProfile profile = service.build(asset(),
                new AssetProfileOptions(Set.of("SLITHER"), Set.of("SEMGREP")));

        assertThat(profile.scannerPlan())
                .filteredOn(item -> item.scanner().equals("SLITHER"))
                .singleElement()
                .satisfies(item -> {
                    assertThat(item.selected()).isTrue();
                    assertThat(item.source()).isEqualTo("INCLUDE_OVERRIDE");
                });
        assertThat(profile.scannerPlan())
                .filteredOn(item -> item.scanner().equals("SEMGREP"))
                .singleElement()
                .satisfies(item -> {
                    assertThat(item.selected()).isFalse();
                    assertThat(item.source()).isEqualTo("EXCLUDE_OVERRIDE");
                });
    }

    @Test
    void buildProfile_selectsScannersForCAndSoliditySources() throws Exception {
        Files.writeString(tempDir.resolve("main.c"), "int main(void) { return 0; }");
        Files.writeString(tempDir.resolve("Vault.sol"), "contract Vault {}");

        ProjectAssetProfile profile = emptyService().build(asset(), AssetProfileOptions.defaults());

        assertThat(profile.scannerPlan())
                .filteredOn(item -> item.selected())
                .extracting(item -> item.scanner())
                .contains("REPOGRAPH_CODE", "SEMGREP", "SLITHER")
                .doesNotContain("CODEQL");
    }

    @Test
    void buildProfile_includesActiveDependencyCveAndGitHotspotSignals() throws Exception {
        Files.writeString(tempDir.resolve("pom.xml"), "<project/>");
        GraphQueryService graph = mock(GraphQueryService.class);
        GraphDiagnosticsService diagnostics = mock(GraphDiagnosticsService.class);
        SbomService sbom = mock(SbomService.class);
        VulnStore vulnStore = mock(VulnStore.class);
        GitChurnAnalyzer churn = mock(GitChurnAnalyzer.class);
        when(graph.projectStats("project-1")).thenReturn(new ProjectStats(
                "project-1", tempDir.toString(), 0, 0, 0, 0, 0,
                Map.of(), Map.of(), Map.of(), Map.of()));
        when(graph.findEntryPoints("project-1")).thenReturn(List.of());
        when(diagnostics.listScanTargets("project-1")).thenReturn(List.of());
        when(sbom.generateCycloneDx(tempDir)).thenReturn("{\"components\":[]}");
        when(vulnStore.list("project-1", null, null)).thenReturn(List.of(new VulnFinding(
                "finding-1", "project-1", "DEP_VULNERABILITY", "CWE-1104", "CRITICAL",
                VulnFinding.SUSPECTED, "dep-1", "org.demo:core", "pom.xml", 1,
                "CVE-2026-0001", "affected dependency", "2026-07-26T10:00:00Z")));
        when(churn.topHotspots("project-1", 10)).thenReturn(List.of(
                new HotspotMetric("src/main/java/App.java", 20, 4, 12.5, 38.06)));

        ProjectAssetProfile profile = new DefaultAssetProfileService(
                graph, diagnostics, sbom, new ObjectMapper(), vulnStore, churn)
                .build(asset(), AssetProfileOptions.defaults());

        assertThat(profile.riskSignals()).extracting(signal -> signal.type())
                .contains("DEPENDENCY_CVE", "HIGH_CHURN_HOTSPOT");
        assertThat(profile.riskSignals())
                .filteredOn(signal -> signal.type().equals("DEPENDENCY_CVE"))
                .singleElement()
                .satisfies(signal -> assertThat(signal.severity()).isEqualTo("CRITICAL"));
    }

    private DefaultAssetProfileService emptyService() {
        GraphQueryService graph = mock(GraphQueryService.class);
        GraphDiagnosticsService diagnostics = mock(GraphDiagnosticsService.class);
        SbomService sbom = mock(SbomService.class);
        VulnStore vulnStore = mock(VulnStore.class);
        GitChurnAnalyzer churn = mock(GitChurnAnalyzer.class);
        when(graph.projectStats("project-1")).thenReturn(new ProjectStats(
                "project-1", tempDir.toString(), 0, 0, 0, 0, 0,
                Map.of(), Map.of(), Map.of(), Map.of()));
        when(graph.findEntryPoints("project-1")).thenReturn(List.of());
        when(diagnostics.listScanTargets("project-1")).thenReturn(List.of());
        when(vulnStore.list("project-1", null, null)).thenReturn(List.of());
        when(churn.topHotspots("project-1", 10)).thenReturn(List.of());
        when(sbom.generateCycloneDx(tempDir)).thenThrow(new IllegalStateException("no build file"));
        return new DefaultAssetProfileService(
                graph, diagnostics, sbom, new ObjectMapper(), vulnStore, churn);
    }

    private ImportedAsset asset() {
        return new ImportedAsset(
                "asset-1", "project-1", "demo.zip", "ZIP", tempDir,
                AssetStatus.READY, "", "2026-07-26T10:00:00Z", "2026-07-26T10:00:01Z", null);
    }

    private static CodeUnit unit(String path, String source, boolean entryPoint) {
        return new CodeUnit(
                path, CodeUnitKind.METHOD, "java", "demo.App#run(String)", "run",
                path, 1, 3, source, "void run(String input)", List.of(), "demo.App",
                entryPoint ? Map.of("is_entry_point", "true") : Map.of());
    }
}
