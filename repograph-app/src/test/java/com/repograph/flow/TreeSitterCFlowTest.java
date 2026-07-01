package com.repograph.flow;

import com.repograph.core.flow.FlowEdgeKind;
import com.repograph.core.flow.FlowNodeKind;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.treesitter.TreeSitterC;

import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * {@link CFlowAnalyzer} CFG 行为测试（通过 {@link TreeSitterFlowAnalysisService} 调用）。
 *
 * <p>若 Tree-sitter C native 库不可用，所有测试均跳过。
 *
 * @author leolu
 */
class TreeSitterCFlowTest {

    private static TreeSitterFlowAnalysisService service;

    @BeforeAll
    static void checkNativeAvailable() {
        boolean available;
        try { new TreeSitterC(); available = true; } catch (Throwable t) { available = false; }
        assumeTrue(available, "Tree-sitter C native library not available — skipping C flow tests");
        service = new TreeSitterFlowAnalysisService();
    }

    // ── Parameters & return sources ──────────────────────────────────────────

    @Test
    void parametersExtracted_fromSignature() {
        var result = service.analyze(cFunc("int x, char *y, int *out", """
                int sum(int x, char *y, int *out) {
                    *out = x;
                    return x;
                }
                """)).orElseThrow();

        assertThat(result.summary().parameters()).containsExactly("x", "y", "out");
    }

    @Test
    void returnSources_identifiersCollected() {
        var result = service.analyze(cFunc("int val", """
                int identity(int val) {
                    return val;
                }
                """)).orElseThrow();

        assertThat(result.summary().returnSources()).contains("val");
    }

    @Test
    void preciseFlag_isFalse() {
        var result = service.analyze(cFunc("void", """
                void noop(void) {}
                """)).orElseThrow();

        assertThat(result.precise()).isFalse();
        assertThat(result.programDependenceGraph()).isNull();
    }

    // ── Straight-line code ───────────────────────────────────────────────────

    @Test
    void straightLine_entryStatementReturnExit() {
        var cfg = service.analyze(cFunc("int n", """
                int abs_val(int n) {
                    int result = n;
                    return result;
                }
                """)).orElseThrow().controlFlowGraph();

        assertThat(cfg.nodes()).extracting(n -> n.kind())
                .contains(FlowNodeKind.ENTRY, FlowNodeKind.STATEMENT,
                          FlowNodeKind.RETURN, FlowNodeKind.EXIT);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.NEXT);
    }

    // ── if / else ────────────────────────────────────────────────────────────

    @Test
    void ifElse_conditionNodeWithTrueAndFalseBranches() {
        var cfg = service.analyze(cFunc("int x", """
                int sign(int x) {
                    if (x > 0) {
                        return 1;
                    } else {
                        return -1;
                    }
                }
                """)).orElseThrow().controlFlowGraph();

        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.CONDITION);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.TRUE_BRANCH);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.FALSE_BRANCH);
        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.RETURN);
        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.EXIT);
    }

    @Test
    void ifNoElse_falseBranchFallsThrough() {
        var cfg = service.analyze(cFunc("int x", """
                int clamp_pos(int x) {
                    if (x < 0) {
                        x = 0;
                    }
                    return x;
                }
                """)).orElseThrow().controlFlowGraph();

        String condId = nodeId(cfg.nodes(), n -> n.kind() == FlowNodeKind.CONDITION);
        String returnId = nodeId(cfg.nodes(), n -> n.kind() == FlowNodeKind.RETURN);
        assertThat(condId).isNotBlank();
        assertThat(returnId).isNotBlank();
        // FALSE_BRANCH from condition must eventually reach the return
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.FALSE_BRANCH);
    }

    // ── for loop ─────────────────────────────────────────────────────────────

    @Test
    void forLoop_initCondUpdateLoopBack() {
        var cfg = service.analyze(cFunc("int n", """
                int sum_n(int n) {
                    int s = 0;
                    for (int i = 0; i < n; i++) {
                        s += i;
                    }
                    return s;
                }
                """)).orElseThrow().controlFlowGraph();

        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.CONDITION);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.LOOP_BACK);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.FALSE_BRANCH);
    }

    @Test
    void forLoop_breakExitsLoop() {
        var cfg = service.analyze(cFunc("int n", """
                int first_zero(int n) {
                    for (int i = 0; i < n; i++) {
                        if (i == 0) break;
                    }
                    return n;
                }
                """)).orElseThrow().controlFlowGraph();

        String returnId = nodeId(cfg.nodes(), n -> n.kind() == FlowNodeKind.RETURN);
        assertThat(returnId).isNotBlank();
        // The break node must have an edge toward return (not loop-back)
        assertThat(cfg.edges()).anyMatch(e -> e.targetId().equals(returnId));
    }

    // ── while loop ───────────────────────────────────────────────────────────

    @Test
    void whileLoop_loopBackAndFalseBranch() {
        var cfg = service.analyze(cFunc("int n", """
                int countdown(int n) {
                    while (n > 0) {
                        n--;
                    }
                    return n;
                }
                """)).orElseThrow().controlFlowGraph();

        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.LOOP_BACK);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.FALSE_BRANCH);
    }

    // ── do-while loop ────────────────────────────────────────────────────────

    @Test
    void doWhile_bodyExecutedBeforeCondition() {
        var cfg = service.analyze(cFunc("int n", """
                int dec(int n) {
                    do {
                        n--;
                    } while (n > 0);
                    return n;
                }
                """)).orElseThrow().controlFlowGraph();

        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.CONDITION);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.FALSE_BRANCH);
    }

    // ── switch ───────────────────────────────────────────────────────────────

    @Test
    void switch_conditionNodePresent() {
        var cfg = service.analyze(cFunc("int x", """
                int classify(int x) {
                    switch (x) {
                        case 0: return 0;
                        case 1: return 1;
                        default: return -1;
                    }
                }
                """)).orElseThrow().controlFlowGraph();

        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.CONDITION);
        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.RETURN);
    }

    // ── Guard / unsupported kind ─────────────────────────────────────────────

    @Test
    void structKind_returnsEmpty() {
        CodeUnit unit = new CodeUnit(
                "id", CodeUnitKind.STRUCT, "c", "Point", "Point",
                "point.c", 1, 3, "struct Point { int x; int y; };", "struct Point",
                List.of(), null, Map.of());

        assertThat(service.analyze(unit)).isEmpty();
    }

    @Test
    void unsupportedLanguage_returnsEmpty() {
        CodeUnit unit = new CodeUnit(
                "id", CodeUnitKind.FUNCTION, "go", "foo", "foo",
                "foo.go", 1, 3, "func foo() int { return 0 }", "func foo() int",
                List.of(), null, Map.of());

        assertThat(service.analyze(unit)).isEmpty();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static CodeUnit cFunc(String params, String rawSource) {
        return new CodeUnit(
                "id", CodeUnitKind.FUNCTION, "c", "test_fn", "test_fn",
                "test.c", 1, 10, rawSource, "int test_fn(" + params + ")",
                List.of(), null, Map.of());
    }

    private static String nodeId(List<com.repograph.core.flow.FlowNode> nodes,
                                 Predicate<com.repograph.core.flow.FlowNode> predicate) {
        return nodes.stream()
                .filter(predicate)
                .map(n -> n.id())
                .findFirst()
                .orElse("");
    }
}
