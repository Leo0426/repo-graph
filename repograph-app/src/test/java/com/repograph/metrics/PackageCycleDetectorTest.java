package com.repograph.metrics;

import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link PackageCycleDetector} 单元测试，验证 Tarjan SCC 算法在包级依赖图上的正确性。
 *
 * @author leolu
 * @since 0.6.0
 */
class PackageCycleDetectorTest {

    // ── Stub ─────────────────────────────────────────────────────────────────

    private static PackageCycleDetector detectorWith(List<ClassEdge> edges) {
        GraphDiagnosticsService stub = new GraphDiagnosticsService() {
            @Override public List<CodeUnit> listScanTargets(String p) { return List.of(); }
            @Override public List<CodeUnit> findDeadCode(String p) { return List.of(); }
            @Override public List<CodeUnit> findTestGaps(String p) { return List.of(); }
            @Override public List<ClassEdge> findClassCallEdges(String p) { return edges; }
        };
        return new PackageCycleDetector(stub);
    }

    // ── No edges / no cycles ─────────────────────────────────────────────────

    @Test
    void emptyGraph_returnsNoCycles() {
        assertThat(detectorWith(List.of()).findCycles("p")).isEmpty();
    }

    @Test
    void linearChain_noCycle() {
        // A → B → C (no cycle)
        List<ClassEdge> edges = List.of(
                new ClassEdge("com.a.Foo", "com.b.Bar"),
                new ClassEdge("com.b.Bar", "com.c.Baz"));
        assertThat(detectorWith(edges).findCycles("p")).isEmpty();
    }

    @Test
    void samePackage_edges_ignored() {
        // Both classes in the same package — no cross-package edge
        List<ClassEdge> edges = List.of(
                new ClassEdge("com.example.Foo", "com.example.Bar"));
        assertThat(detectorWith(edges).findCycles("p")).isEmpty();
    }

    // ── Simple 2-package cycle ────────────────────────────────────────────────

    @Test
    void twoPkg_mutualDependency_oneCycle() {
        // com.a ↔ com.b (A calls B, B calls A)
        List<ClassEdge> edges = List.of(
                new ClassEdge("com.a.Foo", "com.b.Bar"),
                new ClassEdge("com.b.Bar", "com.a.Foo"));

        List<PackageCycle> cycles = detectorWith(edges).findCycles("p");

        assertThat(cycles).hasSize(1);
        assertThat(cycles.get(0).packages()).containsExactlyInAnyOrder("com.a", "com.b");
    }

    @Test
    void twoPkg_onlyOneDirection_noCycle() {
        List<ClassEdge> edges = List.of(
                new ClassEdge("com.a.Foo", "com.b.Bar"));
        assertThat(detectorWith(edges).findCycles("p")).isEmpty();
    }

    // ── 3-package cycle ───────────────────────────────────────────────────────

    @Test
    void threePkg_triangle_oneCycle() {
        // com.a → com.b → com.c → com.a
        List<ClassEdge> edges = List.of(
                new ClassEdge("com.a.A", "com.b.B"),
                new ClassEdge("com.b.B", "com.c.C"),
                new ClassEdge("com.c.C", "com.a.A"));

        List<PackageCycle> cycles = detectorWith(edges).findCycles("p");

        assertThat(cycles).hasSize(1);
        assertThat(cycles.get(0).packages()).containsExactlyInAnyOrder("com.a", "com.b", "com.c");
    }

    // ── Multiple independent cycles ───────────────────────────────────────────

    @Test
    void twoIndependentCycles_bothDetected() {
        // Cycle 1: com.x ↔ com.y
        // Cycle 2: com.p ↔ com.q
        // com.z → com.x (no cycle involving z)
        List<ClassEdge> edges = List.of(
                new ClassEdge("com.x.X", "com.y.Y"),
                new ClassEdge("com.y.Y", "com.x.X"),
                new ClassEdge("com.p.P", "com.q.Q"),
                new ClassEdge("com.q.Q", "com.p.P"),
                new ClassEdge("com.z.Z", "com.x.X"));

        List<PackageCycle> cycles = detectorWith(edges).findCycles("p");

        assertThat(cycles).hasSize(2);
        // Each cycle has exactly 2 packages
        cycles.forEach(c -> assertThat(c.packages()).hasSize(2));
    }

    // ── Largest cycles first ──────────────────────────────────────────────────

    @Test
    void cycles_sortedBySize_largestFirst() {
        // Large cycle: com.a ↔ com.b ↔ com.c ↔ com.a (size 3)
        // Small cycle: com.x ↔ com.y (size 2)
        List<ClassEdge> edges = List.of(
                new ClassEdge("com.a.A", "com.b.B"),
                new ClassEdge("com.b.B", "com.c.C"),
                new ClassEdge("com.c.C", "com.a.A"),
                new ClassEdge("com.x.X", "com.y.Y"),
                new ClassEdge("com.y.Y", "com.x.X"));

        List<PackageCycle> cycles = detectorWith(edges).findCycles("p");

        assertThat(cycles).hasSize(2);
        assertThat(cycles.get(0).packages()).hasSize(3); // largest first
        assertThat(cycles.get(1).packages()).hasSize(2);
    }

    // ── extractPackage helper ─────────────────────────────────────────────────

    @Test
    void extractPackage_returnsParentPackage() {
        assertThat(PackageCycleDetector.extractPackage("com.example.Foo")).isEqualTo("com.example");
    }

    @Test
    void extractPackage_noPackage_returnsEmpty() {
        assertThat(PackageCycleDetector.extractPackage("Foo")).isEmpty();
    }

    @Test
    void extractPackage_null_returnsEmpty() {
        assertThat(PackageCycleDetector.extractPackage(null)).isEmpty();
    }

    @Test
    void extractPackage_deepPackage_returnsDirectParent() {
        assertThat(PackageCycleDetector.extractPackage("com.example.service.impl.OrderServiceImpl"))
                .isEqualTo("com.example.service.impl");
    }
}
