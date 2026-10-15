package com.repograph.api;

import com.repograph.core.wiki.SummaryDocument;
import com.repograph.core.wiki.SummaryLevel;
import com.repograph.core.wiki.SummaryTreeNode;
import com.repograph.wiki.SummaryStore;
import com.repograph.wiki.WikiSummaryJobService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.RejectedExecutionException;

import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link SummaryController} REST 契约测试。
 *
 * @author leolu
 * @since 0.7.0
 */
@WebMvcTest(SummaryController.class)
class SummaryControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    WikiSummaryJobService jobService;

    @MockitoBean
    SummaryStore store;

    private static SummaryDocument doc(String scopeId, SummaryLevel level) {
        return new SummaryDocument("doc-1", "proj1", level, scopeId,
                "标题", List.of(), List.of(), 1, "2026-10-15T10:00:00Z",
                SummaryDocument.STATUS_COMPLETED);
    }

    @Test
    void generate_returnsAcceptedWithRunId() throws Exception {
        when(jobService.submit("proj1")).thenReturn("run-1");

        mvc.perform(post("/api/v1/summaries/generate").param("projectId", "proj1"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.agentRunId").value("run-1"))
                .andExpect(jsonPath("$.pollVia").value("/api/v1/agent-runs/run-1"));
    }

    @Test
    void generate_queueFull_returns503() throws Exception {
        when(jobService.submit("proj1")).thenThrow(new RejectedExecutionException("full"));

        mvc.perform(post("/api/v1/summaries/generate").param("projectId", "proj1"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("EXECUTOR_REJECTED"));
    }

    @Test
    void generate_missingProjectId_returns400() throws Exception {
        mvc.perform(post("/api/v1/summaries/generate"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void list_returnsLatestDocs() throws Exception {
        when(store.listLatest("proj1")).thenReturn(List.of(doc("com.a", SummaryLevel.PACKAGE)));

        mvc.perform(get("/api/v1/summaries").param("projectId", "proj1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].docVersion").value(1));
    }

    @Test
    void tree_mapsDocumentsToNodes() throws Exception {
        when(store.listLatest("proj1")).thenReturn(List.of(doc("com.a", SummaryLevel.PACKAGE)));

        mvc.perform(get("/api/v1/summaries/tree").param("projectId", "proj1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].path").value("package/com.a"))
                .andExpect(jsonPath("$[0].level").value("package"));
    }

    @Test
    void get_existingId_returnsDoc() throws Exception {
        when(store.findById("doc-1")).thenReturn(Optional.of(
                doc(SummaryDocument.PROJECT_SCOPE, SummaryLevel.PROJECT)));

        mvc.perform(get("/api/v1/summaries/doc-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("doc-1"));
    }

    @Test
    void get_missingId_returns404() throws Exception {
        when(store.findById("nope")).thenReturn(Optional.empty());

        mvc.perform(get("/api/v1/summaries/nope"))
                .andExpect(status().isNotFound());
    }
}
