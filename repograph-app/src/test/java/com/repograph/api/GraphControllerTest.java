package com.repograph.api;

import com.repograph.core.graph.GraphDiagnosticsService;
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
import java.util.Set;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link GraphController} 单元测试，验证调用链、影响分析和子类型查询端点。
 *
 * @author leolu
 * @since 0.1.0
 */
@WebMvcTest(GraphController.class)
class GraphControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    GraphQueryService graphQueryService;

    @MockBean
    GraphDiagnosticsService graphDiagnosticsService;

    private static CodeUnit method(String qn) {
        return new CodeUnit("id-" + qn, CodeUnitKind.METHOD, "java",
                qn, qn.contains("#") ? qn.substring(qn.indexOf('#') + 1) : qn,
                "Foo.java", 1, 10, "", qn, List.of(), null, Map.of());
    }

    @Test
    void callers_returnsCallerList() throws Exception {
        when(graphQueryService.findCallers("com.example.Foo#bar", 3))
                .thenReturn(List.of(method("com.example.Caller#test")));

        mvc.perform(get("/api/v1/graph/callers").param("target", "com.example.Foo#bar"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].qualifiedName").value("com.example.Caller#test"));
    }

    @Test
    void callers_customDepth_passed() throws Exception {
        when(graphQueryService.findCallers("com.example.Foo#bar", 1)).thenReturn(List.of());

        mvc.perform(get("/api/v1/graph/callers")
                        .param("target", "com.example.Foo#bar")
                        .param("depth", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void callers_projectId_passedToGraphQuery() throws Exception {
        when(graphQueryService.findCallers("com.example.Foo#bar()", 2, "proj-a"))
                .thenReturn(List.of(method("com.example.Caller#test()")));

        mvc.perform(get("/api/v1/graph/callers")
                        .param("target", "com.example.Foo#bar()")
                        .param("depth", "2")
                        .param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].qualifiedName").value("com.example.Caller#test()"));
    }

    @Test
    void symbols_returnsQualifiedNameCandidates() throws Exception {
        when(graphQueryService.findSymbols("UserService#save", "proj-a", 10))
                .thenReturn(List.of(method("com.example.UserService#save(User)")));

        mvc.perform(get("/api/v1/graph/symbols")
                        .param("q", "UserService#save")
                        .param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].qualifiedName")
                        .value("com.example.UserService#save(User)"));
    }

    @Test
    void impact_returnsAffectedSet() throws Exception {
        when(graphQueryService.impactAnalysis("com.example.Foo"))
                .thenReturn(Set.of(method("com.example.Bar#use")));

        mvc.perform(get("/api/v1/graph/impact").param("target", "com.example.Foo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void subtypes_returnsSubtypeList() throws Exception {
        when(graphQueryService.findSubTypes("com.example.IService"))
                .thenReturn(List.of(method("com.example.ServiceImpl")));

        mvc.perform(get("/api/v1/graph/subtypes").param("target", "com.example.IService"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void callers_notFound_returnsEmptyList() throws Exception {
        when(graphQueryService.findCallers("com.example.Nonexistent#method", 3))
                .thenReturn(List.of());

        mvc.perform(get("/api/v1/graph/callers").param("target", "com.example.Nonexistent#method"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void impact_emptySet_returnsEmptyArray() throws Exception {
        when(graphQueryService.impactAnalysis("com.example.Leaf")).thenReturn(Set.of());

        mvc.perform(get("/api/v1/graph/impact").param("target", "com.example.Leaf"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void subtypes_emptyList_returnsEmptyArray() throws Exception {
        when(graphQueryService.findSubTypes("com.example.LeafClass")).thenReturn(List.of());

        mvc.perform(get("/api/v1/graph/subtypes").param("target", "com.example.LeafClass"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void callees_returnsCalleeList() throws Exception {
        when(graphQueryService.findCallees("com.example.Foo#bar", 3))
                .thenReturn(List.of(method("com.example.Helper#util")));

        mvc.perform(get("/api/v1/graph/callees").param("target", "com.example.Foo#bar"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].qualifiedName").value("com.example.Helper#util"));
    }

    @Test
    void callees_customDepth_passed() throws Exception {
        when(graphQueryService.findCallees("com.example.Foo#bar", 1)).thenReturn(List.of());

        mvc.perform(get("/api/v1/graph/callees")
                        .param("target", "com.example.Foo#bar")
                        .param("depth", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void callees_notFound_returnsEmptyList() throws Exception {
        when(graphQueryService.findCallees("com.example.Leaf#method", 3))
                .thenReturn(List.of());

        mvc.perform(get("/api/v1/graph/callees").param("target", "com.example.Leaf#method"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ── /api/v1/graph/testgaps ────────────────────────────────────────────────

    @Test
    void testgaps_returnsUncoveredMethods() throws Exception {
        when(graphDiagnosticsService.findTestGaps("proj-a"))
                .thenReturn(List.of(
                        method("com.example.Service#doWork"),
                        method("com.example.Repo#query")));

        mvc.perform(get("/api/v1/graph/testgaps").param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].qualifiedName").value("com.example.Service#doWork"));
    }

    @Test
    void testgaps_noGaps_returnsEmptyArray() throws Exception {
        when(graphDiagnosticsService.findTestGaps("proj-covered")).thenReturn(List.of());

        mvc.perform(get("/api/v1/graph/testgaps").param("projectId", "proj-covered"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }
}
