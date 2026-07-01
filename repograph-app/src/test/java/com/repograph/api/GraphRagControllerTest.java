package com.repograph.api;

import com.repograph.core.retrieval.GraphRagOptions;
import com.repograph.core.retrieval.GraphRagResult;
import com.repograph.retrieval.GraphRagService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link GraphRagController} REST 契约测试。
 *
 * @author leolu
 */
@WebMvcTest(GraphRagController.class)
class GraphRagControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    GraphRagService graphRagService;

    @Test
    void graphRag_acceptsImpactExpansionAndClampsLimits() throws Exception {
        GraphRagOptions expected = new GraphRagOptions(
                20, 3, true, true, true, "project-a", "java", true);
        when(graphRagService.search(eq("auth flow"), eq(expected)))
                .thenReturn(new GraphRagResult(List.of(), 0, 0, 0, 0));

        mvc.perform(get("/api/v1/search/graphrag")
                        .param("q", "auth flow")
                        .param("projectId", "project-a")
                        .param("lang", "java")
                        .param("limit", "99")
                        .param("depth", "9")
                        .param("impactExpansion", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.impactExpanded").value(0));

        verify(graphRagService).search("auth flow", expected);
    }

    @Test
    void graphRag_legacyDataFlowParameterRemainsCompatible() throws Exception {
        GraphRagOptions expected = new GraphRagOptions(
                10, 1, true, false, true, null, null, true);
        when(graphRagService.search(eq("auth flow"), eq(expected)))
                .thenReturn(new GraphRagResult(List.of(), 0, 0, 0, 0));

        mvc.perform(get("/api/v1/search/graphrag")
                        .param("q", "auth flow")
                        .param("dataFlow", "false"))
                .andExpect(status().isOk());

        verify(graphRagService).search("auth flow", expected);
    }
}
