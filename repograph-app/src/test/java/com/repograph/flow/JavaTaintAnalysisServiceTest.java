package com.repograph.flow;

import com.repograph.core.flow.MethodTaintSummary;
import com.repograph.core.flow.TaintEdge;
import com.repograph.core.flow.TaintPath;
import com.repograph.core.flow.TaintResult;
import com.repograph.core.flow.TaintSlot;
import com.repograph.core.flow.TaintSummaryService;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * {@link JavaTaintAnalysisService} 跨过程 BFS 逻辑单元测试。
 *
 * @author leolu
 */
@ExtendWith(MockitoExtension.class)
class JavaTaintAnalysisServiceTest {

    @Mock
    TaintSummaryService taintSummaryService;

    @Mock
    GraphQueryService graphQueryService;

    @InjectMocks
    JavaTaintAnalysisService service;

    private static CodeUnit method(String qn) {
        return new CodeUnit("id-" + qn, CodeUnitKind.METHOD, "java", qn,
                qn.contains("#") ? qn.substring(qn.indexOf('#') + 1) : qn,
                "Foo.java", 1, 10, "void m(String p) {}", null,
                List.of(), null, Map.of());
    }

    @Test
    void directSink_onHop_returnsPath() {
        // Controller#login(String) param[0] → executeQuery.arg[0] (Sink)
        CodeUnit loginUnit = method("com.example.Controller#login(String)");
        MethodTaintSummary loginSummary = new MethodTaintSummary(
                loginUnit.qualifiedName(),
                List.of("username"),
                List.of(new TaintEdge(TaintSlot.param(0), TaintSlot.sink("executeQuery", 0))));

        when(graphQueryService.findSymbol("com.example.Controller#login(String)", null))
                .thenReturn(Optional.of(loginUnit));
        when(taintSummaryService.summarize(loginUnit)).thenReturn(Optional.of(loginSummary));

        TaintResult result = service.analyzeTaint(
                "com.example.Controller#login(String)", 0, null, 5);

        assertThat(result.paths()).hasSize(1);
        TaintPath path = result.paths().get(0);
        assertThat(path.reachesSink()).isTrue();
        assertThat(path.sinkDescription()).startsWith("SINK:executeQuery");
        assertThat(path.hops()).hasSize(1);
        assertThat(result.methodsAnalyzed()).isEqualTo(1);
    }

    @Test
    void twoHopChain_propagatesAndFindsSink() {
        // Controller#submit(String) → param[0] → Service#process.arg[0]
        // Service#process(String)  → param[0] → SINK:exec.arg[0]
        CodeUnit submitUnit = method("com.example.Controller#submit(String)");
        CodeUnit processUnit = method("com.example.Service#process(String)");

        MethodTaintSummary submitSummary = new MethodTaintSummary(
                submitUnit.qualifiedName(), List.of("cmd"),
                List.of(new TaintEdge(TaintSlot.param(0), TaintSlot.callArg("process", 0))));
        MethodTaintSummary processSummary = new MethodTaintSummary(
                processUnit.qualifiedName(), List.of("cmd"),
                List.of(new TaintEdge(TaintSlot.param(0), TaintSlot.sink("exec", 0))));

        when(graphQueryService.findSymbol("com.example.Controller#submit(String)", null))
                .thenReturn(Optional.of(submitUnit));
        when(graphQueryService.findSymbol("com.example.Service#process(String)", null))
                .thenReturn(Optional.of(processUnit));
        when(taintSummaryService.summarize(submitUnit)).thenReturn(Optional.of(submitSummary));
        when(taintSummaryService.summarize(processUnit)).thenReturn(Optional.of(processSummary));
        // findCallees of submit returns processUnit
        when(graphQueryService.findCallees(
                eq("com.example.Controller#submit(String)"), eq(1), any()))
                .thenReturn(List.of(processUnit));

        TaintResult result = service.analyzeTaint(
                "com.example.Controller#submit(String)", 0, null, 5);

        assertThat(result.paths()).hasSize(1);
        TaintPath path = result.paths().get(0);
        assertThat(path.reachesSink()).isTrue();
        assertThat(path.hops()).hasSize(2);
        assertThat(path.hops().get(0).methodQn()).isEqualTo("com.example.Controller#submit(String)");
        assertThat(path.hops().get(1).methodQn()).isEqualTo("com.example.Service#process(String)");
        assertThat(result.methodsAnalyzed()).isEqualTo(2);
    }

    @Test
    void noTaintEdgeFromParam_returnsEmptyPaths() {
        CodeUnit unit = method("com.example.Safe#handle(String)");
        // 方法不传播 param[0] 到任何地方
        MethodTaintSummary summary = new MethodTaintSummary(
                unit.qualifiedName(), List.of("data"), List.of());

        when(graphQueryService.findSymbol(anyString(), any())).thenReturn(Optional.of(unit));
        when(taintSummaryService.summarize(unit)).thenReturn(Optional.of(summary));

        TaintResult result = service.analyzeTaint(
                "com.example.Safe#handle(String)", 0, null, 5);

        assertThat(result.paths()).isEmpty();
        assertThat(result.truncated()).isFalse();
    }

    @Test
    void cycleDetection_doesNotLoop() {
        // A → B.arg[0], B → A.arg[0] (循环调用)
        CodeUnit aUnit = method("com.A#a(String)");
        CodeUnit bUnit = method("com.B#b(String)");

        MethodTaintSummary aSummary = new MethodTaintSummary("com.A#a(String)", List.of("x"),
                List.of(new TaintEdge(TaintSlot.param(0), TaintSlot.callArg("b", 0))));
        MethodTaintSummary bSummary = new MethodTaintSummary("com.B#b(String)", List.of("x"),
                List.of(new TaintEdge(TaintSlot.param(0), TaintSlot.callArg("a", 0))));

        when(graphQueryService.findSymbol("com.A#a(String)", null)).thenReturn(Optional.of(aUnit));
        when(graphQueryService.findSymbol("com.B#b(String)", null)).thenReturn(Optional.of(bUnit));
        when(taintSummaryService.summarize(aUnit)).thenReturn(Optional.of(aSummary));
        when(taintSummaryService.summarize(bUnit)).thenReturn(Optional.of(bSummary));
        when(graphQueryService.findCallees(eq("com.A#a(String)"), anyInt(), any()))
                .thenReturn(List.of(bUnit));
        when(graphQueryService.findCallees(eq("com.B#b(String)"), anyInt(), any()))
                .thenReturn(List.of(aUnit));

        // 不应无限循环，终止后路径为空（没有 Sink）
        TaintResult result = service.analyzeTaint("com.A#a(String)", 0, null, 10);
        assertThat(result).isNotNull();
        assertThat(result.paths().stream().anyMatch(TaintPath::reachesSink)).isFalse();
    }
}
