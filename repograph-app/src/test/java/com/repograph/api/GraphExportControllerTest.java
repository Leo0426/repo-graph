package com.repograph.api;

import com.repograph.export.GraphExportService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link GraphExportController} 单元测试，验证 DOT 和 Mermaid 格式端点。
 *
 * @author leolu
 * @since 0.7.0
 */
@WebMvcTest(GraphExportController.class)
class GraphExportControllerTest {

    @Autowired MockMvc mvc;

    @MockBean GraphExportService graphExportService;

    // ── Default format (DOT) ──────────────────────────────────────────────────

    @Test
    void exportGraph_defaultFormat_returnsDot() throws Exception {
        when(graphExportService.exportDot("proj-a"))
                .thenReturn("digraph RepoGraph { }");

        mvc.perform(get("/api/v1/export/graph").param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_PLAIN))
                .andExpect(content().string("digraph RepoGraph { }"));
    }

    // ── DOT format ────────────────────────────────────────────────────────────

    @Test
    void exportGraph_dotFormat_callsExportDot() throws Exception {
        when(graphExportService.exportDot("proj-a"))
                .thenReturn("digraph RepoGraph {\n    rankdir=LR;\n}\n");

        mvc.perform(get("/api/v1/export/graph")
                        .param("projectId", "proj-a")
                        .param("format", "dot"))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("digraph")));
    }

    @Test
    void exportGraph_dotFormatUppercase_callsExportDot() throws Exception {
        when(graphExportService.exportDot("proj-a")).thenReturn("digraph RepoGraph {}");

        mvc.perform(get("/api/v1/export/graph")
                        .param("projectId", "proj-a")
                        .param("format", "DOT"))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("digraph")));
    }

    // ── Mermaid format ────────────────────────────────────────────────────────

    @Test
    void exportGraph_mermaidFormat_callsExportMermaid() throws Exception {
        when(graphExportService.exportMermaid("proj-a"))
                .thenReturn("graph LR\n    com_a[\"com.a\"]\n");

        mvc.perform(get("/api/v1/export/graph")
                        .param("projectId", "proj-a")
                        .param("format", "mermaid"))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("graph LR")));
    }

    @Test
    void exportGraph_mermaidFormatMixedCase_callsExportMermaid() throws Exception {
        when(graphExportService.exportMermaid("proj-a")).thenReturn("graph LR\n");

        mvc.perform(get("/api/v1/export/graph")
                        .param("projectId", "proj-a")
                        .param("format", "Mermaid"))
                .andExpect(status().isOk())
                .andExpect(content().string("graph LR\n"));
    }

    // ── Content type ──────────────────────────────────────────────────────────

    @Test
    void exportGraph_responsesIsTextPlain() throws Exception {
        when(graphExportService.exportDot("proj-a")).thenReturn("");

        mvc.perform(get("/api/v1/export/graph").param("projectId", "proj-a"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_PLAIN));
    }
}
