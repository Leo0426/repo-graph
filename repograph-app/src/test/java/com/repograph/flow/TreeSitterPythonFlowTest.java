package com.repograph.flow;

import com.repograph.core.flow.FlowEdgeKind;
import com.repograph.core.flow.FlowNodeKind;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.treesitter.TreeSitterPython;

import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * {@link PythonFlowAnalyzer} CFG 行为测试（通过 {@link TreeSitterFlowAnalysisService} 调用）。
 *
 * <p>若 Tree-sitter Python native 库不可用，所有测试均跳过。
 *
 * @author leolu
 */
class TreeSitterPythonFlowTest {

    private static TreeSitterFlowAnalysisService service;

    @BeforeAll
    static void checkNativeAvailable() {
        boolean available;
        try { new TreeSitterPython(); available = true; } catch (Throwable t) { available = false; }
        assumeTrue(available, "Tree-sitter Python native library not available — skipping Python flow tests");
        service = new TreeSitterFlowAnalysisService();
    }

    // ── Parameters & return sources ──────────────────────────────────────────

    @Test
    void parametersExtracted_simpleArgs() {
        var result = service.analyze(pyMethod("""
                def add(self, x, y):
                    return x + y
                """)).orElseThrow();

        assertThat(result.summary().parameters()).containsExactly("self", "x", "y");
    }

    @Test
    void parametersExtracted_typeAnnotationsAndDefaults() {
        var result = service.analyze(pyMethod("""
                def fetch(self, url: str, timeout: int = 30, retry: bool = False):
                    pass
                """)).orElseThrow();

        assertThat(result.summary().parameters()).containsExactly("self", "url", "timeout", "retry");
    }

    @Test
    void parametersExtracted_argsAndKwargs() {
        var result = service.analyze(pyMethod("""
                def log(self, *args, **kwargs):
                    pass
                """)).orElseThrow();

        assertThat(result.summary().parameters()).containsExactly("self", "args", "kwargs");
    }

    @Test
    void returnSources_identifiersCollected() {
        var result = service.analyze(pyMethod("""
                def compute(self, value):
                    result = value * 2
                    return result
                """)).orElseThrow();

        assertThat(result.summary().returnSources()).contains("result");
    }

    @Test
    void preciseFlag_isFalse() {
        var result = service.analyze(pyMethod("""
                def noop(self):
                    pass
                """)).orElseThrow();

        assertThat(result.precise()).isFalse();
        assertThat(result.programDependenceGraph()).isNull();
    }

    // ── Straight-line code ───────────────────────────────────────────────────

    @Test
    void straightLine_entryStatementsReturnExit() {
        var cfg = service.analyze(pyMethod("""
                def process(self, x):
                    y = x + 1
                    return y
                """)).orElseThrow().controlFlowGraph();

        assertThat(cfg.nodes()).extracting(n -> n.kind())
                .contains(FlowNodeKind.ENTRY, FlowNodeKind.RETURN, FlowNodeKind.EXIT);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.NEXT);
    }

    // ── if / elif / else ─────────────────────────────────────────────────────

    @Test
    void ifElse_conditionWithTrueAndFalseBranches() {
        var cfg = service.analyze(pyMethod("""
                def sign(self, x):
                    if x > 0:
                        return 1
                    else:
                        return -1
                """)).orElseThrow().controlFlowGraph();

        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.CONDITION);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.TRUE_BRANCH);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.FALSE_BRANCH);
    }

    @Test
    void ifElifElse_multipleConditionNodes() {
        var cfg = service.analyze(pyMethod("""
                def classify(self, x):
                    if x > 0:
                        return 1
                    elif x < 0:
                        return -1
                    else:
                        return 0
                """)).orElseThrow().controlFlowGraph();

        long condCount = cfg.nodes().stream()
                .filter(n -> n.kind() == FlowNodeKind.CONDITION)
                .count();
        assertThat(condCount).isGreaterThanOrEqualTo(2);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.TRUE_BRANCH);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.FALSE_BRANCH);
    }

    // ── for loop ─────────────────────────────────────────────────────────────

    @Test
    void forLoop_loopBackAndFalseBranch() {
        var cfg = service.analyze(pyMethod("""
                def total(self, items):
                    s = 0
                    for item in items:
                        s += item
                    return s
                """)).orElseThrow().controlFlowGraph();

        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.LOOP_BACK);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.FALSE_BRANCH);
    }

    @Test
    void forLoop_breakExitsLoop() {
        var cfg = service.analyze(pyMethod("""
                def first_even(self, nums):
                    for n in nums:
                        if n % 2 == 0:
                            break
                    return n
                """)).orElseThrow().controlFlowGraph();

        String returnId = nodeId(cfg.nodes(), n -> n.kind() == FlowNodeKind.RETURN);
        assertThat(returnId).isNotBlank();
        // break must not loop-back; at least one edge leads to return
        assertThat(cfg.edges()).anyMatch(e -> e.targetId().equals(returnId));
    }

    @Test
    void forLoop_continueSkipsToNextIteration() {
        var cfg = service.analyze(pyMethod("""
                def skip_zero(self, nums):
                    s = 0
                    for n in nums:
                        if n == 0:
                            continue
                        s += n
                    return s
                """)).orElseThrow().controlFlowGraph();

        String condId = nodeId(cfg.nodes(), n -> n.kind() == FlowNodeKind.CONDITION);
        assertThat(condId).isNotBlank();
        // continue must have a LOOP_BACK edge (back to the for-condition)
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.LOOP_BACK);
    }

    // ── while loop ───────────────────────────────────────────────────────────

    @Test
    void whileLoop_loopBackPresent() {
        var cfg = service.analyze(pyMethod("""
                def count_down(self, n):
                    while n > 0:
                        n -= 1
                    return n
                """)).orElseThrow().controlFlowGraph();

        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.CONDITION);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.LOOP_BACK);
    }

    // ── try / except ─────────────────────────────────────────────────────────

    @Test
    void tryExcept_bothPathsLeadToExit() {
        var cfg = service.analyze(pyMethod("""
                def safe_div(self, a, b):
                    try:
                        result = a / b
                    except ZeroDivisionError:
                        result = 0
                    return result
                """)).orElseThrow().controlFlowGraph();

        String returnId = nodeId(cfg.nodes(), n -> n.kind() == FlowNodeKind.RETURN);
        assertThat(returnId).isNotBlank();
        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.EXIT);
        // Both normal and except path must eventually reach EXIT
        assertThat(cfg.edges())
                .filteredOn(e -> e.targetId().equals(returnId))
                .isNotEmpty();
    }

    @Test
    void raise_isTerminalNode() {
        var cfg = service.analyze(pyMethod("""
                def validate(self, x):
                    if x < 0:
                        raise ValueError("negative")
                    return x
                """)).orElseThrow().controlFlowGraph();

        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.THROW);
    }

    // ── Guard / unsupported ──────────────────────────────────────────────────

    @Test
    void wrongLanguage_returnsEmpty() {
        CodeUnit unit = new CodeUnit(
                "id", CodeUnitKind.METHOD, "java", "Foo#bar", "bar",
                "Foo.java", 1, 3, "public void bar() {}", "void bar()",
                List.of(), "Foo", Map.of());

        assertThat(service.analyze(unit)).isEmpty();
    }

    @Test
    void nullRawSource_returnsEmpty() {
        CodeUnit unit = new CodeUnit(
                "id", CodeUnitKind.METHOD, "python", "Foo#bar", "bar",
                "foo.py", 1, 3, null, "def bar(self):",
                List.of(), "Foo", Map.of());

        assertThat(service.analyze(unit)).isEmpty();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static CodeUnit pyMethod(String rawSource) {
        return new CodeUnit(
                "id", CodeUnitKind.METHOD, "python", "MyClass#compute", "compute",
                "my_module.py", 1, 20, rawSource, "def compute(self, ...)",
                List.of(), "MyClass", Map.of());
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
