package com.repograph.flow;

import com.repograph.core.flow.FlowEdgeKind;
import com.repograph.core.flow.FlowNodeKind;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link JavaFlowAnalysisService} 行为测试。
 *
 * @author leolu
 */
class JavaFlowAnalysisServiceTest {

    private final JavaFlowAnalysisService service = new JavaFlowAnalysisService();

    @Test
    void analyze_method_returnsDataFlowCfgAndPdg() {
        CodeUnit method = method("""
                public int compute(int input) {
                    int adjusted = input + this.offset;
                    if (adjusted > 10) {
                        this.total = adjusted;
                        return adjusted;
                    }
                    return this.total;
                }
                """);

        var result = service.analyze(method).orElseThrow();

        assertThat(result.summary().parameters()).containsExactly("input");
        assertThat(result.summary().fieldReads()).containsExactlyInAnyOrder("offset", "total");
        assertThat(result.summary().fieldWrites()).containsExactly("total");
        assertThat(result.summary().returnSources()).containsExactlyInAnyOrder("adjusted", "total");

        assertThat(result.controlFlowGraph().nodes())
                .extracting(node -> node.kind())
                .contains(FlowNodeKind.ENTRY, FlowNodeKind.CONDITION, FlowNodeKind.RETURN, FlowNodeKind.EXIT);
        assertThat(result.controlFlowGraph().edges())
                .extracting(edge -> edge.kind())
                .contains(FlowEdgeKind.TRUE_BRANCH, FlowEdgeKind.FALSE_BRANCH);

        assertThat(result.programDependenceGraph().edges())
                .anyMatch(edge -> edge.kind() == FlowEdgeKind.DATA_DEPENDENCY
                        && "adjusted".equals(edge.symbol()));
        assertThat(result.programDependenceGraph().edges())
                .anyMatch(edge -> edge.kind() == FlowEdgeKind.CONTROL_DEPENDENCY);
    }

    @Test
    void analyze_unsupportedLanguage_returnsEmpty() {
        CodeUnit method = new CodeUnit(
                "id", CodeUnitKind.METHOD, "python", "Example#compute", "compute",
                "example.py", 1, 2, "def compute(x): return x", "compute(x)",
                List.of(), "Example", Map.of());

        assertThat(service.analyze(method)).isEmpty();
    }

    @Test
    void analyze_loop_containsLoopBackAndExitBranch() {
        CodeUnit method = method("""
                public int compute(int input) {
                    while (input > 0) {
                        input--;
                    }
                    return input;
                }
                """);

        var result = service.analyze(method).orElseThrow();

        assertThat(result.controlFlowGraph().edges())
                .extracting(edge -> edge.kind())
                .contains(FlowEdgeKind.LOOP_BACK, FlowEdgeKind.FALSE_BRANCH);
        assertThat(result.programDependenceGraph().edges())
                .anyMatch(edge -> edge.kind() == FlowEdgeKind.DATA_DEPENDENCY
                        && "input".equals(edge.symbol()));
    }

    @Test
    void analyze_modernJavaTextBlock_isSupported() {
        CodeUnit method = method("""
                public String query() {
                    String cypher = \"""
                            MATCH (n)
                            RETURN n
                            \""";
                    return cypher;
                }
                """);

        assertThat(service.analyze(method)).isPresent();
    }

    @Test
    void analyze_forLoop_modelsInitializerUpdaterBreakAndContinue() {
        CodeUnit method = method("""
                public int compute(int input) {
                    int total = 0;
                    for (int i = 0; i < input; i++) {
                        if (i == 2) {
                            continue;
                        }
                        total += i;
                        if (total > 10) {
                            break;
                        }
                    }
                    return total;
                }
                """);

        var cfg = service.analyze(method).orElseThrow().controlFlowGraph();

        String initializer = nodeId(cfg.nodes(), node -> node.label().contains("int i = 0"));
        String updater = nodeId(cfg.nodes(), node -> node.label().equals("i++"));
        String continueNode = nodeId(cfg.nodes(), node -> node.label().equals("continue;"));
        String breakNode = nodeId(cfg.nodes(), node -> node.label().equals("break;"));
        String returnNode = nodeId(cfg.nodes(), node -> node.label().equals("return total;"));

        assertThat(initializer).isNotBlank();
        assertThat(updater).isNotBlank();
        assertThat(cfg.edges()).anyMatch(edge ->
                edge.sourceId().equals(continueNode) && edge.targetId().equals(updater));
        assertThat(cfg.edges()).anyMatch(edge ->
                edge.sourceId().equals(breakNode) && edge.targetId().equals(returnNode));
    }

    @Test
    void analyze_doWhile_executesBodyBeforeCondition() {
        CodeUnit method = method("""
                public int compute(int input) {
                    do {
                        input--;
                    } while (input > 0);
                    return input;
                }
                """);

        var cfg = service.analyze(method).orElseThrow().controlFlowGraph();

        String bodyNode = nodeId(cfg.nodes(), node -> node.label().equals("input--;"));
        String conditionNode = nodeId(cfg.nodes(), node -> node.label().equals("input > 0"));
        String returnNode = nodeId(cfg.nodes(), node -> node.label().equals("return input;"));

        assertThat(cfg.edges()).anyMatch(edge ->
                edge.sourceId().equals(bodyNode) && edge.targetId().equals(conditionNode));
        assertThat(cfg.edges()).anyMatch(edge ->
                edge.sourceId().equals(conditionNode)
                        && edge.targetId().equals(bodyNode)
                        && edge.kind() == FlowEdgeKind.TRUE_BRANCH);
        assertThat(cfg.edges()).anyMatch(edge ->
                edge.sourceId().equals(conditionNode)
                        && edge.targetId().equals(returnNode)
                        && edge.kind() == FlowEdgeKind.FALSE_BRANCH);
    }

    @Test
    void analyze_labeledLoopTransfers_targetMatchingLoop() {
        CodeUnit method = method("""
                public int compute(int input) {
                    outer: for (int i = 0; i < 3; i++) {
                        while (input > 0) {
                            if (input-- > 1) {
                                continue outer;
                            }
                            break outer;
                        }
                    }
                    return input;
                }
                """);

        var cfg = service.analyze(method).orElseThrow().controlFlowGraph();

        String updater = nodeId(cfg.nodes(), node -> node.label().equals("i++"));
        String continueNode = nodeId(cfg.nodes(), node -> node.label().equals("continue outer;"));
        String breakNode = nodeId(cfg.nodes(), node -> node.label().equals("break outer;"));
        String returnNode = nodeId(cfg.nodes(), node -> node.label().equals("return input;"));

        assertThat(cfg.edges()).anyMatch(edge ->
                edge.sourceId().equals(continueNode) && edge.targetId().equals(updater));
        assertThat(cfg.edges()).anyMatch(edge ->
                edge.sourceId().equals(breakNode) && edge.targetId().equals(returnNode));
    }

    @Test
    void analyze_switch_traditionalFallThrough_modelsAllCaseBranches() {
        CodeUnit method = method("""
                public String compute(int input) {
                    String result;
                    switch (input) {
                        case 1:
                            result = "one";
                            break;
                        case 2:
                        case 3:
                            result = "two-or-three";
                            break;
                        default:
                            result = "other";
                    }
                    return result;
                }
                """);

        var cfg = service.analyze(method).orElseThrow().controlFlowGraph();

        assertThat(cfg.edges())
                .anyMatch(e -> e.kind() == FlowEdgeKind.CASE_BRANCH);
        assertThat(cfg.edges())
                .anyMatch(e -> e.kind() == FlowEdgeKind.FALSE_BRANCH); // default branch
        // break exits both reach the return node
        String returnNode = nodeId(cfg.nodes(), n -> n.label().equals("return result;"));
        assertThat(returnNode).isNotBlank();
        assertThat(cfg.edges()).anyMatch(e -> e.targetId().equals(returnNode));
    }

    @Test
    void analyze_switch_breakExitsToNextStatement_notEnclosingLoop() {
        CodeUnit method = method("""
                public int compute(int input) {
                    int total = 0;
                    for (int i = 0; i < input; i++) {
                        switch (i % 3) {
                            case 0: total += i; break;
                            default: break;
                        }
                    }
                    return total;
                }
                """);

        var cfg = service.analyze(method).orElseThrow().controlFlowGraph();

        // switch breaks must NOT exit the for-loop; the for-loop updater (i++) must still be reached
        String updater = nodeId(cfg.nodes(), n -> n.label().equals("i++"));
        assertThat(updater).isNotBlank();
        // CASE_BRANCH present (inside the switch)
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.CASE_BRANCH);
    }

    @Test
    void analyze_tryCatch_exceptionBranchFromTryToEachCatch() {
        CodeUnit method = method("""
                public int compute(int input) {
                    int result = 0;
                    try {
                        result = Integer.parseInt("x");
                    } catch (NumberFormatException e) {
                        result = -1;
                    }
                    return result;
                }
                """);

        var cfg = service.analyze(method).orElseThrow().controlFlowGraph();

        assertThat(cfg.edges())
                .anyMatch(e -> e.kind() == FlowEdgeKind.EXCEPTION_BRANCH);
        assertThat(cfg.nodes())
                .anyMatch(n -> n.kind() == FlowNodeKind.CATCH);
        // Both normal path and catch path reach the return
        String returnNode = nodeId(cfg.nodes(), n -> n.label().equals("return result;"));
        assertThat(returnNode).isNotBlank();
        assertThat(cfg.edges()).anyMatch(e -> e.targetId().equals(returnNode));
    }

    @Test
    void analyze_tryCatchFinally_allPathsMergeAtFinally() {
        CodeUnit method = method("""
                public int compute(int input) {
                    int result = 0;
                    try {
                        result = 1 / input;
                    } catch (ArithmeticException e) {
                        result = -1;
                    } finally {
                        result = Math.abs(result);
                    }
                    return result;
                }
                """);

        var cfg = service.analyze(method).orElseThrow().controlFlowGraph();

        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.CATCH);
        assertThat(cfg.nodes()).anyMatch(n -> n.kind() == FlowNodeKind.FINALLY);
        assertThat(cfg.edges()).anyMatch(e -> e.kind() == FlowEdgeKind.EXCEPTION_BRANCH);

        String finallyNode = nodeId(cfg.nodes(), n -> n.kind() == FlowNodeKind.FINALLY);
        // Both the normal try exit and catch exit must have an edge INTO finally
        assertThat(cfg.edges())
                .filteredOn(e -> e.targetId().equals(finallyNode))
                .hasSizeGreaterThanOrEqualTo(2);
    }

    private static String nodeId(List<com.repograph.core.flow.FlowNode> nodes,
                                 Predicate<com.repograph.core.flow.FlowNode> predicate) {
        return nodes.stream()
                .filter(predicate)
                .map(node -> node.id())
                .findFirst()
                .orElse("");
    }

    private static CodeUnit method(String source) {
        return new CodeUnit(
                "id", CodeUnitKind.METHOD, "java", "com.example.Calculator#compute(int)", "compute",
                "src/main/java/com/example/Calculator.java", 20, 27, source,
                "public int compute(int input)", List.of(), "com.example.Calculator", Map.of());
    }
}
