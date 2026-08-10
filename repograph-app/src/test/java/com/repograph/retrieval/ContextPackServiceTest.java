package com.repograph.retrieval;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.retrieval.ContextPackOptions;
import com.repograph.core.retrieval.GraphRagOptions;
import com.repograph.core.retrieval.GraphRagResult;
import com.repograph.core.retrieval.RankedUnit;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@link ContextPackService} 行为测试。
 *
 * @author leolu
 */
class ContextPackServiceTest {

    @Test
    void build_assignsCitationsAndTruncatesByBudget() {
        GraphRagService graphRagService = mock(GraphRagService.class);
        String source = "a".repeat(1500);
        CodeUnit unit = new CodeUnit("id", CodeUnitKind.METHOD, "java",
                "com.example.Auth#login()", "login",
                "src/main/java/com/example/Auth.java", 10, 30, source,
                "void login()", List.of(), "com.example.Auth", Map.of());
        RankedUnit ranked = new RankedUnit(unit, 0.9f, 0.1f, 0.95f,
                "VECTOR", "SEED", List.of("entry_point"));
        when(graphRagService.search(eq("auth"), any(GraphRagOptions.class)))
                .thenReturn(new GraphRagResult(List.of(ranked), 1, 0, 0, 1));

        ContextPackService service = new ContextPackService(graphRagService);
        var pack = service.build("auth",
                new ContextPackOptions("security", 1000, GraphRagOptions.defaults()));

        assertThat(pack.evidence()).singleElement().satisfies(e -> {
            assertThat(e.citationId()).isEqualTo("C1");
            assertThat(e.excerpt()).hasSize(1000);
            assertThat(e.truncated()).isTrue();
        });
        assertThat(pack.omittedReasons()).anyMatch(reason -> reason.contains("truncated"));
        assertThat(pack.usedBudgetChars()).isEqualTo(1000);
        assertThat(pack.keywordSeedCount()).isZero();
    }

    @Test
    void assembleDistributesBudgetAcrossSeveralRankedCandidates() {
        ContextPackService service = new ContextPackService(mock(GraphRagService.class));
        List<RankedUnit> candidates = java.util.stream.IntStream.rangeClosed(1, 5)
                .mapToObj(index -> rankedUnit(index, "x".repeat(2_000)))
                .toList();

        var pack = service.assemble(
                "command injection", new ContextPackOptions("security", 4_000, GraphRagOptions.defaults()),
                candidates, 1, 4, 0, 0, List.of());

        assertThat(pack.evidence()).hasSize(4);
        assertThat(pack.evidence()).allSatisfy(evidence -> {
            assertThat(evidence.excerpt()).hasSize(1_000);
            assertThat(evidence.truncated()).isTrue();
        });
        assertThat(pack.usedBudgetChars()).isEqualTo(4_000);
        assertThat(pack.omittedReasons()).anyMatch(reason -> reason.contains("budget exhausted"));
    }

    private static RankedUnit rankedUnit(int index, String source) {
        CodeUnit unit = new CodeUnit("id-" + index, CodeUnitKind.METHOD, "java",
                "com.example.Service#method" + index + "()", "method" + index,
                "src/Service" + index + ".java", 1, 20, source,
                "void method" + index + "()", List.of(), "com.example.Service", Map.of());
        return new RankedUnit(unit, 0.9f, 0.1f, 0.95f,
                index == 1 ? "FINDING" : "KEYWORD", "SEED", List.of());
    }
}
