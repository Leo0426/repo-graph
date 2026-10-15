package com.repograph.wiki;

import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.metrics.ComplexityAnalyzer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@link StructureFactCollector} 单元测试：Mock 图诊断接口，验证包分组、
 * 跨包出入度、关键符号与入口点统计。
 *
 * @author leolu
 * @since 0.7.0
 */
@ExtendWith(MockitoExtension.class)
class StructureFactCollectorTest {

    @Mock
    GraphDiagnosticsService diagnostics;

    private StructureFactCollector collector;

    @BeforeEach
    void setUp() {
        collector = new StructureFactCollector(diagnostics, new ComplexityAnalyzer(diagnostics));
    }

    private static CodeUnit unit(String qualifiedName, String filePath, boolean entryPoint) {
        Map<String, String> meta = entryPoint
                ? Map.of("is_entry_point", "true") : Map.of();
        return new CodeUnit("id-" + qualifiedName, CodeUnitKind.CLASS, "java",
                qualifiedName, "Cls", filePath, 1, 10, "class X {}",
                "class X", List.of(), null, meta);
    }

    @Test
    void collect_groupsByPackage_andAggregatesEdges() {
        List<CodeUnit> units = List.of(
                unit("com.a.Foo", "src/Foo.java", true),
                unit("com.a.Bar", "src/Bar.java", false),
                unit("com.b.Baz", "src/Baz.java", false),
                unit("util", "src/util.c", false)); // C 顶层函数 → (root)
        when(diagnostics.listSearchTargets("proj", null, null, false, 20000)).thenReturn(units);
        when(diagnostics.findClassCallEdges("proj")).thenReturn(List.of(
                new ClassEdge("com.b.Baz", "com.a.Foo"),
                new ClassEdge("com.a.Bar", "com.b.Baz")));
        when(diagnostics.findDeadCode("proj")).thenReturn(List.of(units.get(3)));

        ProjectStructureFacts facts = collector.collect("proj");

        assertThat(facts.unitCount()).isEqualTo(4);
        assertThat(facts.entryPointCount()).isEqualTo(1);
        assertThat(facts.deadCodeCount()).isEqualTo(1);
        assertThat(facts.crossPackageEdgeCount()).isEqualTo(2); // 去重后的跨包类边对

        PackageFacts pkgA = facts.packages().stream()
                .filter(p -> "com.a".equals(p.pkg())).findFirst().orElseThrow();
        assertThat(pkgA.unitCount()).isEqualTo(2);
        assertThat(pkgA.entryPointCount()).isEqualTo(1);
        assertThat(pkgA.inboundCalls()).isEqualTo(1);   // com.b → com.a
        assertThat(pkgA.outboundCalls()).isEqualTo(1);  // com.a.Bar → com.b
        assertThat(pkgA.keySymbols()).containsExactly("com.a.Foo");

        PackageFacts root = facts.packages().stream()
                .filter(p -> PackageFacts.ROOT_PACKAGE.equals(p.pkg())).findFirst().orElseThrow();
        assertThat(root.unitCount()).isEqualTo(1);
    }

    @Test
    void collect_emptyProject_returnsZeroUnits() {
        when(diagnostics.listSearchTargets("empty", null, null, false, 20000))
                .thenReturn(List.of());

        ProjectStructureFacts facts = collector.collect("empty");

        assertThat(facts.unitCount()).isZero();
        assertThat(facts.packages()).isEmpty();
    }

    @Test
    void collect_packagesSortedByInboundDesc() {
        List<CodeUnit> units = List.of(
                unit("com.x.Hot", "src/Hot.java", false),
                unit("com.y.Cold", "src/Cold.java", false));
        when(diagnostics.listSearchTargets("proj", null, null, false, 20000)).thenReturn(units);
        when(diagnostics.findClassCallEdges("proj")).thenReturn(List.of(
                new ClassEdge("com.y.Cold", "com.x.Hot")));
        when(diagnostics.findDeadCode("proj")).thenReturn(List.of());

        ProjectStructureFacts facts = collector.collect("proj");

        assertThat(facts.packages().get(0).pkg()).isEqualTo("com.x");
        assertThat(facts.packages().get(0).inboundCalls()).isEqualTo(1);
    }
}
