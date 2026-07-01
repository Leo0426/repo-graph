package com.repograph.api;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import com.repograph.core.graph.ProjectStats;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link ProjectsController} 单元测试，验证项目发现端点的响应结构。
 *
 * @author leolu
 * @since 0.2.0
 */
@WebMvcTest(ProjectsController.class)
class ProjectsControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    GraphQueryService graphQueryService;

    @Test
    void projects_returnsList() throws Exception {
        when(graphQueryService.listProjects()).thenReturn(List.of(
                new ProjectInfo("abc123def456", "/Users/leo/projA", 1200L, "2026-06-11T10:00:00Z"),
                new ProjectInfo("7890fedcba98", "/Users/leo/projB", 450L, "2026-06-10T15:30:00Z")
        ));

        mvc.perform(get("/api/v1/projects"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].projectId").value("abc123def456"))
                .andExpect(jsonPath("$[0].projectRoot").value("/Users/leo/projA"))
                .andExpect(jsonPath("$[0].nodeCount").value(1200))
                .andExpect(jsonPath("$[1].projectId").value("7890fedcba98"));
    }

    @Test
    void projects_empty_returnsEmptyArray() throws Exception {
        when(graphQueryService.listProjects()).thenReturn(List.of());

        mvc.perform(get("/api/v1/projects"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void projectStats_returnsAggregatedCounts() throws Exception {
        // Use LinkedHashMap so the JSON property ordering matches insertion.
        Map<String, Long> kinds = new LinkedHashMap<>();
        kinds.put("METHOD", 80L);
        kinds.put("CLASS", 20L);
        Map<String, Long> langs = Map.of("java", 100L);
        Map<String, Long> fws = Map.of("spring", 5L);
        Map<String, Long> edges = Map.of("CALLS", 150L, "EXTENDS", 4L);

        when(graphQueryService.projectStats("abc123def456")).thenReturn(new ProjectStats(
                "abc123def456", "/Users/leo/projA",
                100L, 12L, 154L, 5L, 7L,
                kinds, langs, fws, edges));

        mvc.perform(get("/api/v1/projects/abc123def456/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").value("abc123def456"))
                .andExpect(jsonPath("$.totalUnits").value(100))
                .andExpect(jsonPath("$.totalFiles").value(12))
                .andExpect(jsonPath("$.totalEdges").value(154))
                .andExpect(jsonPath("$.entryPointCount").value(5))
                .andExpect(jsonPath("$.testCount").value(7))
                .andExpect(jsonPath("$.kindDistribution.METHOD").value(80))
                .andExpect(jsonPath("$.kindDistribution.CLASS").value(20))
                .andExpect(jsonPath("$.languageDistribution.java").value(100))
                .andExpect(jsonPath("$.frameworkDistribution.spring").value(5))
                .andExpect(jsonPath("$.edgeKindDistribution.CALLS").value(150));
    }

    @Test
    void projectStats_unknownProject_returnsZeroPayload() throws Exception {
        when(graphQueryService.projectStats("missing")).thenReturn(new ProjectStats(
                "missing", "", 0L, 0L, 0L, 0L, 0L,
                Map.of(), Map.of(), Map.of(), Map.of()));

        mvc.perform(get("/api/v1/projects/missing/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalUnits").value(0))
                .andExpect(jsonPath("$.kindDistribution.length()").value(0));
    }
}
