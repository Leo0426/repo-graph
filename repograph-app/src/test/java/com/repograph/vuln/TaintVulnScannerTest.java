package com.repograph.vuln;

import com.repograph.core.flow.TaintAnalysisService;
import com.repograph.core.flow.TaintHop;
import com.repograph.core.flow.TaintPath;
import com.repograph.core.flow.TaintResult;
import com.repograph.core.flow.TaintSlot;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link TaintVulnScanner} 污染链源码证据测试。
 *
 * @author leolu
 */
class TaintVulnScannerTest {

    @Test
    void scanPersistsSourcePropagationAndSinkCodeEvidence() {
        GraphDiagnosticsService graph = mock(GraphDiagnosticsService.class);
        TaintAnalysisService analysis = mock(TaintAnalysisService.class);
        VulnStore store = mock(VulnStore.class);
        CodeUnit controller = method(
                "com.example.Controller#run(String)", "Controller.java", 10, 14,
                "@PostMapping void run(@RequestParam String command) { service.process(command); }");
        CodeUnit service = method(
                "com.example.Service#process(String)", "Service.java", 20, 24,
                "void process(String command) { Runtime.getRuntime().exec(command); }");
        TaintPath path = new TaintPath(List.of(
                new TaintHop(controller.qualifiedName(), TaintSlot.param(0), TaintSlot.callArg("process", 0)),
                new TaintHop(service.qualifiedName(), TaintSlot.param(0), TaintSlot.sink("exec", 0))),
                true, "SINK:exec.arg[0]");
        when(graph.listScanTargets("project-1")).thenReturn(List.of(controller, service));
        when(analysis.analyzeTaint(controller.qualifiedName(), 0, "project-1", 6))
                .thenReturn(new TaintResult(controller.qualifiedName(), 0, List.of(path), 2, false));

        new TaintVulnScanner(graph, analysis, store).scan("project-1");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<TaintEvidenceStep>> steps = ArgumentCaptor.forClass(List.class);
        verify(store).replaceTaintEvidence(anyString(), steps.capture());
        assertThat(steps.getValue()).extracting(TaintEvidenceStep::role)
                .containsExactly("SOURCE", "PROPAGATION", "SINK");
        assertThat(steps.getValue().get(0)).satisfies(step -> {
            assertThat(step.filePath()).isEqualTo("Controller.java");
            assertThat(step.startLine()).isEqualTo(10);
            assertThat(step.sourceExcerpt()).contains("@PostMapping", "service.process");
        });
        assertThat(steps.getValue().get(2)).satisfies(step -> {
            assertThat(step.filePath()).isEqualTo("Service.java");
            assertThat(step.toSlot()).isEqualTo("SINK:exec.arg[0]");
            assertThat(step.sourceExcerpt()).contains("Runtime.getRuntime().exec");
        });
    }

    private static CodeUnit method(String qualifiedName, String filePath, int startLine, int endLine, String source) {
        String simpleName = qualifiedName.substring(qualifiedName.indexOf('#') + 1);
        return new CodeUnit(qualifiedName, CodeUnitKind.METHOD, "java", qualifiedName, simpleName,
                filePath, startLine, endLine, source, source, List.of(),
                qualifiedName.substring(0, qualifiedName.indexOf('#')), Map.of());
    }
}
