package com.repograph.metrics;

import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link CouplingAnalyzer} 单元测试，验证 fan-in / fan-out / instability 计算逻辑。
 *
 * @author leolu
 * @since 0.6.0
 */
class CouplingAnalyzerTest {

    // ── Stub ─────────────────────────────────────────────────────────────────

    private static CouplingAnalyzer analyzerWith(List<ClassEdge> edges) {
        GraphDiagnosticsService stub = new GraphDiagnosticsService() {
            @Override public List<CodeUnit> listScanTargets(String p) { return List.of(); }
            @Override public List<CodeUnit> findDeadCode(String p) { return List.of(); }
            @Override public List<CodeUnit> findTestGaps(String p) { return List.of(); }
            @Override public List<ClassEdge> findClassCallEdges(String p) { return edges; }
        };
        return new CouplingAnalyzer(stub);
    }

    // ── Empty graph ───────────────────────────────────────────────────────────

    @Test
    void emptyGraph_returnsNoMetrics() {
        CouplingAnalyzer analyzer = analyzerWith(List.of());
        assertThat(analyzer.compute("proj")).isEmpty();
    }

    // ── Fan-out counting ──────────────────────────────────────────────────────

    @Test
    void fanOut_countedPerCallerClass() {
        // A → B, A → C  ⇒  A.fanOut = 2
        List<ClassEdge> edges = List.of(
                new ClassEdge("com.example.A", "com.example.B"),
                new ClassEdge("com.example.A", "com.example.C"));

        CouplingMetric a = findClass(analyzerWith(edges).compute("p"), "com.example.A");
        assertThat(a.fanOut()).isEqualTo(2);
        assertThat(a.fanIn()).isEqualTo(0);
    }

    @Test
    void fanOut_deduplicatesDuplicateEdges() {
        // A → B appears twice (different method calls, same pair of classes)
        List<ClassEdge> edges = List.of(
                new ClassEdge("com.example.A", "com.example.B"),
                new ClassEdge("com.example.A", "com.example.B"));

        CouplingMetric a = findClass(analyzerWith(edges).compute("p"), "com.example.A");
        assertThat(a.fanOut()).isEqualTo(1);
    }

    // ── Fan-in counting ───────────────────────────────────────────────────────

    @Test
    void fanIn_countedPerCalleeClass() {
        // A → C, B → C  ⇒  C.fanIn = 2
        List<ClassEdge> edges = List.of(
                new ClassEdge("com.example.A", "com.example.C"),
                new ClassEdge("com.example.B", "com.example.C"));

        CouplingMetric c = findClass(analyzerWith(edges).compute("p"), "com.example.C");
        assertThat(c.fanIn()).isEqualTo(2);
        assertThat(c.fanOut()).isEqualTo(0);
    }

    // ── Instability ───────────────────────────────────────────────────────────

    @Test
    void instability_pureCallerIs1() {
        // A only calls out — never called in
        List<ClassEdge> edges = List.of(new ClassEdge("com.example.A", "com.example.B"));
        CouplingMetric a = findClass(analyzerWith(edges).compute("p"), "com.example.A");
        assertThat(a.instability()).isEqualTo(1.0);
    }

    @Test
    void instability_pureCalleeIs0() {
        // B is only called — never calls out
        List<ClassEdge> edges = List.of(new ClassEdge("com.example.A", "com.example.B"));
        CouplingMetric b = findClass(analyzerWith(edges).compute("p"), "com.example.B");
        assertThat(b.instability()).isEqualTo(0.0);
    }

    @Test
    void instability_balanced_isHalf() {
        // A → B, C → A  ⇒  A: fanIn=1, fanOut=1, I = 0.5
        List<ClassEdge> edges = List.of(
                new ClassEdge("com.example.A", "com.example.B"),
                new ClassEdge("com.example.C", "com.example.A"));

        CouplingMetric a = findClass(analyzerWith(edges).compute("p"), "com.example.A");
        assertThat(a.fanIn()).isEqualTo(1);
        assertThat(a.fanOut()).isEqualTo(1);
        assertThat(a.instability()).isEqualTo(0.5);
    }

    // ── Sorting ───────────────────────────────────────────────────────────────

    @Test
    void topByFanOut_orderedDescending() {
        // A: fanOut=3, B: fanOut=1, C: fanOut=2
        List<ClassEdge> edges = List.of(
                new ClassEdge("A", "X"), new ClassEdge("A", "Y"), new ClassEdge("A", "Z"),
                new ClassEdge("B", "X"),
                new ClassEdge("C", "X"), new ClassEdge("C", "Y"));

        List<CouplingMetric> top = analyzerWith(edges).topByFanOut("p", 10);
        assertThat(top.get(0).classQualifiedName()).isEqualTo("A");
        assertThat(top.get(1).classQualifiedName()).isEqualTo("C");
        assertThat(top.get(2).classQualifiedName()).isEqualTo("B");
    }

    @Test
    void topByFanIn_orderedDescending() {
        // X: fanIn=3 (called by A,B,C), Y: fanIn=2, Z: fanIn=1
        List<ClassEdge> edges = List.of(
                new ClassEdge("A", "X"), new ClassEdge("B", "X"), new ClassEdge("C", "X"),
                new ClassEdge("A", "Y"), new ClassEdge("B", "Y"),
                new ClassEdge("A", "Z"));

        List<CouplingMetric> top = analyzerWith(edges).topByFanIn("p", 10);
        CouplingMetric first = top.stream()
                .filter(m -> m.classQualifiedName().equals("X")).findFirst().orElseThrow();
        assertThat(first.fanIn()).isEqualTo(3);
        assertThat(top.get(0).fanIn()).isGreaterThanOrEqualTo(top.get(1).fanIn());
    }

    @Test
    void topByFanOut_respectsLimit() {
        List<ClassEdge> edges = List.of(
                new ClassEdge("A", "X"), new ClassEdge("B", "Y"), new ClassEdge("C", "Z"));

        List<CouplingMetric> top = analyzerWith(edges).topByFanOut("p", 2);
        assertThat(top).hasSize(2);
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    private static CouplingMetric findClass(List<CouplingMetric> metrics, String cls) {
        return metrics.stream()
                .filter(m -> m.classQualifiedName().equals(cls))
                .findFirst()
                .orElseThrow(() -> new AssertionError("class not found: " + cls));
    }
}
