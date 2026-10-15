package com.repograph.wiki;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.advisory.LlmAdvisoryProperties;
import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.wiki.SummaryDocument;
import com.repograph.core.wiki.SummaryLevel;
import com.repograph.core.wiki.SummarySection;
import com.repograph.core.wiki.WikiModelException;
import com.repograph.core.wiki.WikiSummaryModel;
import com.repograph.metrics.ComplexityAnalyzer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link DefaultSummaryGenerationService} 集成测试：真实 SQLite（临时目录）+
 * Mock 图诊断 + 可控桩模型，验证确定性路径、LLM 章节、citation 白名单、
 * 阶段缓存与降级语义。
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

    private StubWikiSummaryModel stubModel;
    private DefaultSummaryGenerationService service;
    private SummaryStore store;

    @BeforeEach
    void setUp() {
        store = new SummaryStore(tempDir.resolve("test.db").toString(), new ObjectMapper());
        stubModel = new StubWikiSummaryModel();
        service = new DefaultSummaryGenerationService(
                new StructureFactCollector(diagnostics, new ComplexityAnalyzer(diagnostics)),
                store, stubModel,
                new SummaryGenerationCache(tempDir.resolve("test.db").toString(), new ObjectMapper()),
                LlmAdvisoryProperties.defaults(), new ObjectMapper());
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
        assertThat(project.model()).isNull();
        assertThat(project.sections()).extracting(com.repograph.core.wiki.SummarySection::title)
                .containsExactly("项目概述", "模块划分", "入口与调用链", "复杂度热点", "说明");
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

    // ── S2:LLM 架构摘要 ──────────────────────────────────────────────────────

    @Test
    void generateWithLlm_appendsLlmSections_andValidatesCitations() {
        stubProjectGraph();
        // 5 个章节；「模块划分」引用白名单外符号 + 合法符号
        for (int i = 0; i < 5; i++) {
            if (i == 1) {
                stubModel.enqueue("{\"body\":\"模块正文\",\"citations\":"
                        + "[\"com.a.Foo#run\",\"com.z.NotAllowed\"]}");
            } else {
                stubModel.enqueue("{\"body\":\"章节正文 " + i + "\",\"citations\":[]}");
            }
        }
        stubModel.setEnabled(true, "test-model");

        SummaryGenerationOutcome outcome = service.generateWithOutcome("proj", true);

        assertThat(outcome.llmUsed()).isTrue();
        assertThat(outcome.model()).isEqualTo("test-model");
        SummaryDocument project = outcome.documents().stream()
                .filter(d -> d.level() == SummaryLevel.PROJECT).findFirst().orElseThrow();
        assertThat(project.model()).isEqualTo("test-model");
        assertThat(project.sections())
                .filteredOn(s -> "llm".equals(s.source()))
                .hasSize(5);
        // 合法 citation 定位到复杂度指标并合并进文档；白名单外引用进 missingInfo
        assertThat(project.citations()).anySatisfy(c ->
                assertThat(c.qualifiedName()).isEqualTo("com.a.Foo#run"));
        assertThat(outcome.missingInfo()).anySatisfy(m ->
                assertThat(m).contains("com.z.NotAllowed"));
        assertThat(project.status()).isEqualTo(SummaryDocument.STATUS_COMPLETED);
    }

    @Test
    void generateWithLlm_modelFailure_marksPartial() {
        stubProjectGraph();
        stubModel.setEnabled(true, "test-model");
        stubModel.failWith(new WikiModelException("endpoint down"));

        SummaryGenerationOutcome outcome = service.generateWithOutcome("proj", true);

        SummaryDocument project = outcome.documents().stream()
                .filter(d -> d.level() == SummaryLevel.PROJECT).findFirst().orElseThrow();
        assertThat(project.status()).isEqualTo(SummaryDocument.STATUS_PARTIAL);
        assertThat(project.sections())
                .noneSatisfy(s -> assertThat(s.source()).isEqualTo("llm"));
        assertThat(outcome.missingInfo()).hasSize(5);
        assertThat(outcome.llmUsed()).isFalse();
    }

    @Test
    void generateWithLlm_disabledModel_keepsDeterministicOnly() {
        stubProjectGraph();
        stubModel.setEnabled(false, "");

        SummaryGenerationOutcome outcome = service.generateWithOutcome("proj", true);

        assertThat(outcome.llmUsed()).isFalse();
        assertThat(stubModel.calls).isZero();
        SummaryDocument project = outcome.documents().stream()
                .filter(d -> d.level() == SummaryLevel.PROJECT).findFirst().orElseThrow();
        assertThat(project.model()).isNull();
        assertThat(project.status()).isEqualTo(SummaryDocument.STATUS_COMPLETED);
    }

    @Test
    void generateWithLlm_sameFacts_usesCacheInsteadOfModel() {
        stubProjectGraph();
        stubModel.setEnabled(true, "test-model");
        for (int i = 0; i < 5; i++) {
            stubModel.enqueue("{\"body\":\"章节正文 " + i + "\",\"citations\":[]}");
        }
        service.generateWithOutcome("proj", true);
        service.generateWithOutcome("proj", true);

        // 第二次全部命中缓存：模型调用次数不变
        verify(diagnostics, times(2)).listSearchTargets("proj", null, null, false, 20000);
        assertThat(stubModel.calls).isEqualTo(5);
    }

    /** 可控桩模型：按队列返回响应或抛出异常。 */
    private static final class StubWikiSummaryModel implements WikiSummaryModel {
        private final Deque<String> responses = new ArrayDeque<>();
        private WikiModelException failure;
        private boolean enabled;
        private String modelName = "";
        private int calls;

        void enqueue(String response) {
            responses.add(response);
        }

        void setEnabled(boolean enabled, String model) {
            this.enabled = enabled;
            this.modelName = model;
        }

        void failWith(WikiModelException failure) {
            this.failure = failure;
        }

        @Override
        public boolean available() {
            return enabled;
        }

        @Override
        public String model() {
            return modelName;
        }

        @Override
        public String complete(String systemPrompt, String userPrompt) {
            calls++;
            if (failure != null) {
                throw failure;
            }
            String next = responses.poll();
            if (next == null) {
                throw new WikiModelException("no stubbed response");
            }
            return next;
        }
    }
}
