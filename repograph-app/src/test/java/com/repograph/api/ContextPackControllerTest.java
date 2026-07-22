package com.repograph.api;

import com.repograph.core.retrieval.ContextPack;
import com.repograph.core.retrieval.ContextPackOptions;
import com.repograph.core.retrieval.GraphRagOptions;
import com.repograph.retrieval.ContextPackService;
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
 * {@link ContextPackController} REST 契约测试。
 *
 * @author leolu
 */
@WebMvcTest(ContextPackController.class)
class ContextPackControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    ContextPackService contextPackService;

    @Test
    void pack_clampsGraphAndBudgetOptions() throws Exception {
        GraphRagOptions graphRag = new GraphRagOptions(
                20, 3, true, true, true, "project-a", "java", true);
        ContextPackOptions expected = new ContextPackOptions("security", 60000, graphRag);
        when(contextPackService.build(eq("auth flow"), eq(expected)))
                .thenReturn(new ContextPack("auth flow", "security", List.of(), List.of(),
                        60000, 0, 0, 0, 0));

        mvc.perform(get("/api/v1/context/pack")
                        .param("q", "auth flow")
                        .param("taskType", "security")
                        .param("budgetChars", "999999")
                        .param("projectId", "project-a")
                        .param("lang", "java")
                        .param("limit", "99")
                        .param("depth", "9"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.taskType").value("security"))
                .andExpect(jsonPath("$.requestedBudgetChars").value(60000));

        verify(contextPackService).build("auth flow", expected);
    }
}
