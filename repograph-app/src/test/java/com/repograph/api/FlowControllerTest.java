package com.repograph.api;

import com.repograph.core.flow.ControlFlowGraph;
import com.repograph.core.flow.DataFlowSummary;
import com.repograph.core.flow.FlowAnalysisResult;
import com.repograph.core.flow.FlowAnalysisService;
import com.repograph.core.flow.ProgramDependenceGraph;
import com.repograph.core.flow.TaintAnalysisService;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link FlowController} REST 契约测试。
 *
 * @author leolu
 */
@WebMvcTest(FlowController.class)
class FlowControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    GraphQueryService graphQueryService;

    @MockBean
    FlowAnalysisService flowAnalysisService;

    @MockBean
    TaintAnalysisService taintAnalysisService;

    @Test
    void analyze_exactSymbol_returnsFlowAnalysis() throws Exception {
        CodeUnit method = new CodeUnit(
                "id", CodeUnitKind.METHOD, "java", "Foo#run(String)", "run",
                "Foo.java", 1, 3, "void run(String input) {}", "void run(String input)",
                List.of(), "Foo", Map.of());
        FlowAnalysisResult result = new FlowAnalysisResult(
                method.qualifiedName(), "java",
                new DataFlowSummary(List.of("input"), List.of(), List.of(), List.of()),
                new ControlFlowGraph(List.of(), List.of()),
                new ProgramDependenceGraph(List.of(), List.of()),
                true);
        when(graphQueryService.findSymbol("Foo#run(String)", "proj-a")).thenReturn(Optional.of(method));
        when(flowAnalysisService.analyze(method)).thenReturn(Optional.of(result));

        mvc.perform(get("/api/v1/flow/analyze")
                        .param("target", "Foo#run(String)")
                        .param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.target").value("Foo#run(String)"))
                .andExpect(jsonPath("$.summary.parameters[0]").value("input"));
    }
}
