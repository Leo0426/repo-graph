package com.repograph.flow;

import com.repograph.core.flow.MethodTaintSummary;
import com.repograph.core.flow.TaintSlot;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link JavaFlowTaintSummarizer} 通过 catch 块传播污点的能力。
 */
class JavaFlowTaintSummarizerTest {

    private final JavaFlowAnalysisService service = new JavaFlowAnalysisService();

    @Test
    void catchParam_taintedWhenTryBodyContainsTaintedVar() {
        // input is tainted; it appears in the try body, so 'e' should become tainted,
        // making e.getMessage() a tainted argument to the sink println.
        CodeUnit method = method("""
                public void process(String input) {
                    try {
                        Integer.parseInt(input);
                    } catch (NumberFormatException e) {
                        System.out.println(e.getMessage());
                    }
                }
                """);

        MethodTaintSummary summary = service.summarize(method).orElseThrow();

        assertThat(summary.edges())
                .anyMatch(edge -> edge.from().equals(TaintSlot.param(0))
                        && edge.to().kind() == TaintSlot.SlotKind.SINK
                        && "println".equals(edge.to().calleeHint()));
    }

    @Test
    void catchParam_propagatesThroughAssignmentToSink() {
        // input → try body → e (catch param) → msg (assignment) → executeQuery (sink)
        CodeUnit method = method("""
                public void process(String input) {
                    try {
                        doSomething(input);
                    } catch (Exception e) {
                        String msg = e.getMessage();
                        executeQuery(msg);
                    }
                }
                """);

        MethodTaintSummary summary = service.summarize(method).orElseThrow();

        assertThat(summary.edges())
                .anyMatch(edge -> edge.from().equals(TaintSlot.param(0))
                        && edge.to().kind() == TaintSlot.SlotKind.SINK
                        && "executeQuery".equals(edge.to().calleeHint()));
    }

    @Test
    void catchParam_notTainted_whenTryBodyHasNoTaintedVar() {
        // try body only uses a literal — catch 'e' must NOT become tainted
        CodeUnit method = method("""
                public void process(String input) {
                    try {
                        int x = Integer.parseInt("42");
                    } catch (Exception e) {
                        executeQuery(e.getMessage());
                    }
                }
                """);

        MethodTaintSummary summary = service.summarize(method).orElseThrow();

        assertThat(summary.edges())
                .noneMatch(edge -> edge.to().kind() == TaintSlot.SlotKind.SINK
                        && "executeQuery".equals(edge.to().calleeHint()));
    }

    @Test
    void multipleCatchClauses_allReceiveTaint() {
        // input in try → both IOException 'ioe' and RuntimeException 're' should be tainted
        CodeUnit method = method("""
                public void process(String input) {
                    try {
                        doSomething(input);
                    } catch (java.io.IOException ioe) {
                        println(ioe.getMessage());
                    } catch (RuntimeException re) {
                        write(re.getMessage());
                    }
                }
                """);

        MethodTaintSummary summary = service.summarize(method).orElseThrow();

        assertThat(summary.edges())
                .anyMatch(edge -> edge.from().equals(TaintSlot.param(0))
                        && edge.to().kind() == TaintSlot.SlotKind.SINK
                        && "println".equals(edge.to().calleeHint()));
        assertThat(summary.edges())
                .anyMatch(edge -> edge.from().equals(TaintSlot.param(0))
                        && edge.to().kind() == TaintSlot.SlotKind.SINK
                        && "write".equals(edge.to().calleeHint()));
    }

    private static CodeUnit method(String source) {
        return new CodeUnit(
                "id", CodeUnitKind.METHOD, "java",
                "com.example.Processor#process(String)", "process",
                "src/main/java/com/example/Processor.java", 1, 10,
                source, "public void process(String input)",
                List.of(), "com.example.Processor", Map.of());
    }
}
