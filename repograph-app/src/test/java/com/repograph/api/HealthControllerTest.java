package com.repograph.api;

import com.repograph.vector.embedding.OllamaEmbeddingService;
import com.repograph.vector.store.QdrantVectorStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.neo4j.driver.Driver;
import org.neo4j.driver.Result;
import org.neo4j.driver.Session;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link HealthController} 单元测试，验证健康检查端点的聚合逻辑。
 *
 * @author leolu
 * @since 0.1.0
 */
@WebMvcTest(HealthController.class)
@Import(HealthService.class)
class HealthControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    OllamaEmbeddingService ollamaService;

    @MockBean
    QdrantVectorStore qdrantStore;

    @MockBean
    Driver neo4jDriver;

    @BeforeEach
    void wireNeo4jSession() {
        // Default: Neo4j ping succeeds. Individual tests override by stubbing the driver again.
        stubNeo4jSession(true);
    }

    private void stubNeo4jSession(boolean ok) {
        Session session = mock(Session.class);
        Result result = mock(Result.class);
        when(neo4jDriver.session()).thenReturn(session);
        if (ok) {
            when(session.run(anyString())).thenReturn(result);
            // result.consume() returns ResultSummary; Mockito's default null is fine here
        } else {
            when(session.run(anyString())).thenThrow(new RuntimeException("Neo4j unreachable"));
        }
    }

    @Test
    void health_allOk_returns200() throws Exception {
        when(qdrantStore.isHealthy()).thenReturn(true);

        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.qdrant").value("ok"))
                .andExpect(jsonPath("$.ollama").value("ok"))
                .andExpect(jsonPath("$.neo4j").value("ok"));
    }

    @Test
    void health_qdrantFails_returns207() throws Exception {
        when(qdrantStore.isHealthy()).thenReturn(false);

        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isMultiStatus())
                .andExpect(jsonPath("$.status").value("degraded"))
                .andExpect(jsonPath("$.qdrant").value("error"))
                .andExpect(jsonPath("$.ollama").value("ok"))
                .andExpect(jsonPath("$.neo4j").value("ok"));
    }

    @Test
    void health_ollamaFails_returns207() throws Exception {
        when(qdrantStore.isHealthy()).thenReturn(true);
        doThrow(new RuntimeException("Ollama unreachable")).when(ollamaService).healthCheck();

        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isMultiStatus())
                .andExpect(jsonPath("$.status").value("degraded"))
                .andExpect(jsonPath("$.qdrant").value("ok"))
                .andExpect(jsonPath("$.ollama").value("error"))
                .andExpect(jsonPath("$.neo4j").value("ok"));
    }

    @Test
    void health_neo4jFails_returns207() throws Exception {
        when(qdrantStore.isHealthy()).thenReturn(true);
        stubNeo4jSession(false);

        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isMultiStatus())
                .andExpect(jsonPath("$.status").value("degraded"))
                .andExpect(jsonPath("$.qdrant").value("ok"))
                .andExpect(jsonPath("$.ollama").value("ok"))
                .andExpect(jsonPath("$.neo4j").value("error"));
    }

    @Test
    void health_allFail_returns207() throws Exception {
        when(qdrantStore.isHealthy()).thenReturn(false);
        doThrow(new RuntimeException("Ollama unreachable")).when(ollamaService).healthCheck();
        stubNeo4jSession(false);

        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isMultiStatus())
                .andExpect(jsonPath("$.status").value("degraded"))
                .andExpect(jsonPath("$.qdrant").value("error"))
                .andExpect(jsonPath("$.ollama").value("error"))
                .andExpect(jsonPath("$.neo4j").value("error"));
    }
}
