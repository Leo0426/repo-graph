package com.repograph.wiki;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.wiki.SummaryDocument;
import com.repograph.core.wiki.SummaryLevel;
import com.repograph.metrics.ComplexityAnalyzer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@link DefaultSummaryGenerationService} 集成测试：真实 SQLite（临时目录）+
 * Mock 图诊断，验证项目级 + 包级文档生成、版本递增与空项目行为。
 *
 * @author leolu
 * @since 0.7.0
 */
@ExtendWith(MockitoExtension.class)
class DefaultSummaryGenerationServiceTest {

    @Mock
    GraphDiagnosticsService diagnostics;

    @TempDir
    Path tempDir;

    private DefaultSummaryGenerationService service;

    @BeforeEach
    void setUp() {
        SummaryStore store = new SummaryStore(tempDir.resolve("test.db").toString(),
                new ObjectMapper());
        service = new DefaultSummaryGenerationService(
                new StructureFactCollector(diagnostics, new ComplexityAnalyzer(diagnostics)),
                store);
    }

    private static CodeUnit unit(String qualifiedName, String filePath, int ccLines) {
        StringBuilder raw = new StringBuilder("void m() {");
        raw.append("\n");
        for (int i = 0; i < ccLines; i++) {
            raw.append("if (x) {}\n");
        }
        raw.append("}");
        Map<String, String> meta = "com.a.Foo#run".equals(qualifiedName)
                ? Map.of("is_entry_point", "true") : Map.of();
        return new CodeUnit("id-" + qualifiedName, CodeUnitKind.METHOD, "java",
                qualifiedName, "m", filePath, 1, ccLines + 2, raw.toString(),
                "void m()", List.of(), null, meta);
    }

    private void stubProjectGraph() {
        List<CodeUnit> units = List.of(
                unit("com.a.Foo#run", "src/Foo.java", 12),   // CC 高 + 入口点
                unit("com.a.Bar#ok", "src/Bar.java", 1),
                unit("com.b.Baz#go", "src/Baz.java", 2));
        when(diagnostics.listSearchTargets("proj", null, null, false, 20000)).thenReturn(units);
        when(diagnostics.listScanTargets("proj")).thenReturn(units);
        when(diagnostics.findClassCallEdges("proj")).thenReturn(List.of(
                new ClassEdge("com.b.Baz", "com.a.Foo")));
        when(diagnostics.findDeadCode("proj")).thenReturn(List.of());
    }

    @Test
    void generate_producesProjectAndPackageDocs_withCitations() {
        stubProjectGraph();

        List<SummaryDocument> docs = service.generate("proj");

        assertThat(docs).hasSize(3); // 项目级 + com.a + com.b

        SummaryDocument project = docs.stream()
                .filter(d -> d.level() == SummaryLevel.PROJECT).findFirst().orElseThrow();
        assertThat(project.docVersion()).isEqualTo(1);
        assertThat(project.status()).isEqualTo(SummaryDocument.STATUS_COMPLETED);
        assertThat(project.sections()).extracting(com.repograph.core.wiki.SummarySection::title)
                .containsExactly("项目概述", "模块划分", "入口与调用链", "复杂度热点", "说明");
        // 复杂度热点产生 citation（com.a.Foo#run CC=13）
        assertThat(project.citations()).anySatisfy(c ->
                assertThat(c.qualifiedName()).isEqualTo("com.a.Foo#run"));

        SummaryDocument pkgA = docs.stream()
                .filter(d -> "com.a".equals(d.scopeId())).findFirst().orElseThrow();
        assertThat(pkgA.level()).isEqualTo(SummaryLevel.PACKAGE);
        assertThat(pkgA.sections().get(0).body()).contains("入口点单元：1");
        assertThat(pkgA.citations()).anySatisfy(c ->
                assertThat(c.filePath()).isEqualTo("src/Foo.java"));
    }

    @Test
    void generate_twice_incrementsDocVersion() {
        stubProjectGraph();
        service.generate("proj");

        List<SummaryDocument> second = service.generate("proj");

        assertThat(second).allSatisfy(d -> assertThat(d.docVersion()).isEqualTo(2));
    }

    @Test
    void generate_emptyProject_returnsEmpty() {
        when(diagnostics.listSearchTargets("empty", null, null, false, 20000))
                .thenReturn(List.of());

        assertThat(service.generate("empty")).isEmpty();
    }
}
