package com.repograph.app.pipeline;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.vector.EmbeddingService;
import com.repograph.core.vector.VectorStore;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Tests embedding and vector upsert orchestration.
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
class EmbeddingUpsertRunnerTest {

    @Mock
    EmbeddingService embeddingService;
    @Mock
    VectorStore vectorStore;

    private EmbeddingUpsertRunner runner;

    @AfterEach
    void tearDown() {
        if (runner != null) {
            runner.shutdown();
        }
    }

    @Test
    void embedAndUpsert_buildsDualVectorsAndPublishesProgress() {
        runner = new EmbeddingUpsertRunner(embeddingService, vectorStore, null);
        CodeUnit unit = new CodeUnit("id-1", CodeUnitKind.METHOD, "java",
                "com.example.Foo#bar", "bar", "Foo.java", 2, 4,
                "void bar() {}", "void bar()", List.of("@GetMapping"), "com.example.Foo", Map.of());
        when(embeddingService.embed(anyList())).thenReturn(List.of(new float[]{0.1f, 0.2f}));
        List<Integer> progress = new ArrayList<>();

        int embedded = runner.embedAndUpsert(List.of(unit), "project-1", Path.of("/tmp/project"),
                new ArrayList<>(), (root, done, total) -> progress.add(done));

        assertThat(embedded).isEqualTo(1);
        assertThat(progress).containsExactly(1);
        verify(vectorStore).upsert(argThat(units -> units.size() == 1), eq("project-1"));
        verify(embeddingService, org.mockito.Mockito.times(2)).embed(anyList());
    }

    // ── buildSemanticText ──────────────────────────────────────────────────

    @Test
    void buildSemanticText_classUnit_usesOwnAnnotationsAndSignature() {
        CodeUnit cls = classUnit("com.example.Foo", "@Service", "class Foo");
        String text = EmbeddingUpsertRunner.buildSemanticText(cls, Map.of());
        assertThat(text).isEqualTo("@Service class Foo");
    }

    @Test
    void buildSemanticText_methodUnit_prependsParentContext() {
        CodeUnit cls = classUnit("com.example.Foo", "@Component",
                "class Foo", "/** Scans project roots for supported source files. */\n@Component\nclass Foo {}");
        CodeUnit method = methodUnit("com.example.Foo#scan", "com.example.Foo",
                "List<Path> scan(Path root)", List.of());

        String text = EmbeddingUpsertRunner.buildSemanticText(method, Map.of("com.example.Foo", cls));

        assertThat(text).startsWith("Scans project roots for supported source files.");
        assertThat(text).contains("@Component").contains("class Foo");
        assertThat(text).endsWith("List<Path> scan(Path root)");
    }

    @Test
    void buildSemanticText_methodUnit_noParentInMap_fallsBackToOwnText() {
        CodeUnit method = methodUnit("com.example.Foo#scan", "com.example.Foo",
                "List<Path> scan(Path root)", List.of());
        String text = EmbeddingUpsertRunner.buildSemanticText(method, Map.of());
        assertThat(text).isEqualTo("List<Path> scan(Path root)");
    }

    @Test
    void buildSemanticText_methodUnit_noParentQn_noEnrichment() {
        CodeUnit method = new CodeUnit("id", CodeUnitKind.METHOD, "java",
                "com.example.Foo#scan", "scan", "Foo.java", 1, 5,
                "List<Path> scan() {}", "List<Path> scan()", List.of(), null, Map.of());
        String text = EmbeddingUpsertRunner.buildSemanticText(method, Map.of());
        assertThat(text).isEqualTo("List<Path> scan()");
    }

    // ── extractDocSummary ─────────────────────────────────────────────────

    @Test
    void extractDocSummary_extractsFirstSentence() {
        String raw = "/** Scans project roots for source files. More detail here. */\nclass Foo {}";
        assertThat(EmbeddingUpsertRunner.extractDocSummary(raw))
                .isEqualTo("Scans project roots for source files.");
    }

    @Test
    void extractDocSummary_stripsLeadingAsterisks() {
        String raw = "/**\n * Builds semantic embeddings.\n * @author leolu\n */\nclass Bar {}";
        assertThat(EmbeddingUpsertRunner.extractDocSummary(raw))
                .isEqualTo("Builds semantic embeddings.");
    }

    @Test
    void extractDocSummary_noComment_returnsEmpty() {
        assertThat(EmbeddingUpsertRunner.extractDocSummary("class Foo {}")).isEmpty();
        assertThat(EmbeddingUpsertRunner.extractDocSummary(null)).isEmpty();
        assertThat(EmbeddingUpsertRunner.extractDocSummary("")).isEmpty();
    }

    @Test
    void extractDocSummary_skipsAtTags() {
        String raw = "/**\n * @param x the value\n * Processes input.\n */\nclass Baz {}";
        assertThat(EmbeddingUpsertRunner.extractDocSummary(raw))
                .isEqualTo("Processes input.");
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private static CodeUnit classUnit(String qn, String ann, String sig) {
        return classUnit(qn, ann, sig, "");
    }

    private static CodeUnit classUnit(String qn, String ann, String sig, String raw) {
        String simple = qn.substring(qn.lastIndexOf('.') + 1);
        return new CodeUnit("id-" + simple, CodeUnitKind.CLASS, "java",
                qn, simple, simple + ".java", 1, 10,
                raw, sig, ann.isEmpty() ? List.of() : List.of(ann), null, Map.of());
    }

    private static CodeUnit methodUnit(String qn, String parentQn, String sig, List<String> anns) {
        String simple = qn.substring(qn.lastIndexOf('#') + 1);
        return new CodeUnit("id-" + simple, CodeUnitKind.METHOD, "java",
                qn, simple, "Foo.java", 5, 10,
                "// body", sig, anns, parentQn, Map.of());
    }
}
