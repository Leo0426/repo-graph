package com.repograph.export;

import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.metrics.PackageCycle;
import com.repograph.metrics.PackageCycleDetector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@link GraphExportService} 单元测试，验证 DOT 和 Mermaid 格式的正确生成。
 *
 * @author leolu
 * @since 0.7.0
 */
@ExtendWith(MockitoExtension.class)
class GraphExportServiceTest {

    @Mock GraphDiagnosticsService graphQueryService;
    @Mock PackageCycleDetector packageCycleDetector;

    GraphExportService service;

    private static final String PID = "proj-test";

    @BeforeEach
    void setUp() {
        service = new GraphExportService(graphQueryService, packageCycleDetector);
    }

    private void stubEdges(List<ClassEdge> edges) {
        when(graphQueryService.findClassCallEdges(PID)).thenReturn(edges);
    }

    private void stubCycles(List<PackageCycle> cycles) {
        when(packageCycleDetector.findCycles(PID)).thenReturn(cycles);
    }

    // ── Empty graph ───────────────────────────────────────────────────────────

    @Test
    void exportDot_emptyEdges_returnsMinimalDot() {
        stubEdges(List.of());
        stubCycles(List.of());
        String dot = service.exportDot(PID);
        assertThat(dot).startsWith("digraph RepoGraph {");
        assertThat(dot).endsWith("}\n");
    }

    @Test
    void exportMermaid_emptyEdges_returnsHeaderOnly() {
        stubEdges(List.of());
        stubCycles(List.of());
        String mermaid = service.exportMermaid(PID);
        assertThat(mermaid).startsWith("graph LR\n");
    }

    // ── Single edge ───────────────────────────────────────────────────────────

    @Test
    void exportDot_singleEdge_containsBothPackages() {
        stubEdges(List.of(new ClassEdge("com.example.controller.FooCtrl", "com.example.service.FooSvc")));
        stubCycles(List.of());
        String dot = service.exportDot(PID);
        assertThat(dot).contains("com.example.controller").contains("com.example.service");
    }

    @Test
    void exportDot_singleEdge_containsArrow() {
        stubEdges(List.of(new ClassEdge("com.a.Foo", "com.b.Bar")));
        stubCycles(List.of());
        String dot = service.exportDot(PID);
        assertThat(dot).contains("com.a\" -> \"com.b\"");
    }

    @Test
    void exportMermaid_singleEdge_containsArrow() {
        stubEdges(List.of(new ClassEdge("com.a.Foo", "com.b.Bar")));
        stubCycles(List.of());
        String mermaid = service.exportMermaid(PID);
        // Edge includes count: com_a -->|1| com_b
        assertThat(mermaid).contains("com_a -->").contains("com_b");
    }

    // ── Edge count deduplication ──────────────────────────────────────────────

    @Test
    void exportDot_multipleCallsSamePackagePair_countedTogether() {
        // 3 class-to-class calls between same packages
        stubEdges(List.of(
                new ClassEdge("com.a.A1", "com.b.B1"),
                new ClassEdge("com.a.A2", "com.b.B2"),
                new ClassEdge("com.a.A1", "com.b.B2")));
        stubCycles(List.of());
        String dot = service.exportDot(PID);
        // Should have label "3" for the edge count
        assertThat(dot).contains("label=\"3\"");
    }

    @Test
    void exportMermaid_multipleCallsSamePackagePair_edgeCountInLabel() {
        stubEdges(List.of(
                new ClassEdge("com.a.A1", "com.b.B1"),
                new ClassEdge("com.a.A2", "com.b.B2")));
        stubCycles(List.of());
        String mermaid = service.exportMermaid(PID);
        assertThat(mermaid).contains("|2|");
    }

    // ── Same-package edges excluded ───────────────────────────────────────────

    @Test
    void exportDot_samePackageEdge_excluded() {
        stubEdges(List.of(new ClassEdge("com.example.FooA", "com.example.FooB")));
        stubCycles(List.of());
        String dot = service.exportDot(PID);
        // No edges → only header/footer, no node definitions
        assertThat(dot).doesNotContain("->");
    }

    @Test
    void exportMermaid_samePackageEdge_excluded() {
        stubEdges(List.of(new ClassEdge("com.x.A", "com.x.B")));
        stubCycles(List.of());
        String mermaid = service.exportMermaid(PID);
        assertThat(mermaid).doesNotContain("-->");
    }

    // ── Cycle highlighting ────────────────────────────────────────────────────

    @Test
    void exportDot_cyclicPackage_highlightedRed() {
        stubEdges(List.of(
                new ClassEdge("com.a.A", "com.b.B"),
                new ClassEdge("com.b.B", "com.a.A")));
        stubCycles(List.of(new PackageCycle(List.of("com.a", "com.b"))));

        String dot = service.exportDot(PID);
        assertThat(dot).contains("color=red").contains("fillcolor");
    }

    @Test
    void exportDot_noCycles_noRedColor() {
        stubEdges(List.of(new ClassEdge("com.a.A", "com.b.B")));
        stubCycles(List.of());
        String dot = service.exportDot(PID);
        assertThat(dot).doesNotContain("color=red");
    }

    @Test
    void exportMermaid_cyclicPackage_hasClassDef() {
        stubEdges(List.of(
                new ClassEdge("com.a.A", "com.b.B"),
                new ClassEdge("com.b.B", "com.a.A")));
        stubCycles(List.of(new PackageCycle(List.of("com.a", "com.b"))));

        String mermaid = service.exportMermaid(PID);
        assertThat(mermaid).contains("classDef cyclic");
    }

    // ── DOT structure ─────────────────────────────────────────────────────────

    @Test
    void exportDot_containsRankdirLR() {
        stubEdges(List.of());
        stubCycles(List.of());
        assertThat(service.exportDot(PID)).contains("rankdir=LR");
    }

    @Test
    void exportDot_containsProjectIdInLabel() {
        stubEdges(List.of());
        stubCycles(List.of());
        assertThat(service.exportDot(PID)).contains(PID);
    }

    @Test
    void exportDot_validDigraphSyntax() {
        stubEdges(List.of(new ClassEdge("com.a.X", "com.b.Y")));
        stubCycles(List.of());
        String dot = service.exportDot(PID);
        assertThat(dot)
                .startsWith("digraph RepoGraph {")
                .endsWith("}\n")
                .contains("->");
    }

    // ── Mermaid structure ─────────────────────────────────────────────────────

    @Test
    void exportMermaid_containsGraphLR() {
        stubEdges(List.of());
        stubCycles(List.of());
        assertThat(service.exportMermaid(PID)).startsWith("graph LR\n");
    }

    @Test
    void exportMermaid_nodeIdUsesUnderscores() {
        stubEdges(List.of(new ClassEdge("com.example.Foo", "com.other.Bar")));
        stubCycles(List.of());
        String mermaid = service.exportMermaid(PID);
        assertThat(mermaid).contains("com_example").contains("com_other");
    }

    @Test
    void exportMermaid_nodeLabelContainsDots() {
        // Use deep package so shortName returns last 2 segments with a dot
        stubEdges(List.of(new ClassEdge("com.example.service.FooSvc", "com.example.repo.FooRepo")));
        stubCycles(List.of());
        String mermaid = service.exportMermaid(PID);
        // package = "com.example.service" → shortName = "example.service"
        assertThat(mermaid).contains("example.service").contains("example.repo");
    }

    // ── Static helpers ────────────────────────────────────────────────────────

    @Test
    void shortName_shortPackage_returnsAsIs() {
        assertThat(GraphExportService.shortName("com.example")).isEqualTo("com.example");
    }

    @Test
    void shortName_deepPackage_returnsLastTwoSegments() {
        assertThat(GraphExportService.shortName("com.example.service.impl"))
                .isEqualTo("service.impl");
    }

    @Test
    void shortName_twoSegments_returnsAsIs() {
        assertThat(GraphExportService.shortName("com.example")).isEqualTo("com.example");
    }

    @Test
    void mermaidId_replacesDots() {
        assertThat(GraphExportService.mermaidId("com.example.service"))
                .isEqualTo("com_example_service");
    }

    @Test
    void mermaidId_replacesHyphens() {
        assertThat(GraphExportService.mermaidId("com.my-project.svc"))
                .isEqualTo("com_my_project_svc");
    }

    @Test
    void mermaidId_emptyString_returnsEmptySentinel() {
        assertThat(GraphExportService.mermaidId("")).isEqualTo("_empty");
    }
}
