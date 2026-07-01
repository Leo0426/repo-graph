package com.repograph.api;

import com.repograph.vector.embedding.OllamaEmbeddingService;
import com.repograph.vector.store.QdrantVectorStore;
import org.neo4j.driver.Driver;
import org.neo4j.driver.Session;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 外部服务健康探测，供 {@link HealthController} 和 {@link FragmentController} 共用。
 */
@Service
class HealthService {

    private final OllamaEmbeddingService ollama;
    private final QdrantVectorStore qdrant;
    private final Driver neo4j;

    HealthService(OllamaEmbeddingService ollama, QdrantVectorStore qdrant, Driver neo4j) {
        this.ollama = ollama;
        this.qdrant = qdrant;
        this.neo4j = neo4j;
    }

    Map<String, String> check() {
        String qdrantStatus = qdrant.isHealthy() ? "ok" : "error";

        String ollamaStatus;
        try { ollama.healthCheck(); ollamaStatus = "ok"; }
        catch (Exception e) { ollamaStatus = "error"; }

        String neo4jStatus;
        try (Session s = neo4j.session()) { s.run("RETURN 1").consume(); neo4jStatus = "ok"; }
        catch (Exception e) { neo4jStatus = "error"; }

        Map<String, String> result = new LinkedHashMap<>();
        result.put("status", (qdrantStatus + ollamaStatus + neo4jStatus).equals("okokok") ? "ok" : "degraded");
        result.put("qdrant", qdrantStatus);
        result.put("ollama", ollamaStatus);
        result.put("neo4j", neo4jStatus);
        return result;
    }
}
