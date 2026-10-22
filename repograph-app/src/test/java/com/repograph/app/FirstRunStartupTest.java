package com.repograph.app;

import com.fasterxml.jackson.databind.JsonNode;
import com.repograph.app.pipeline.IndexHistoryStore;
import com.repograph.core.pipeline.IndexOptions;
import com.repograph.core.pipeline.IndexPipeline;
import com.repograph.graph.CodeGraph;
import com.repograph.vector.embedding.OllamaEmbeddingService;
import com.repograph.vector.store.QdrantVectorStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.neo4j.driver.Driver;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

/**
 * 完整应用在全新数据目录下启动并经 HTTP 完成索引；仅替换外部图、向量和模型服务。
 *
 * @author leolu
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class FirstRunStartupTest {

    @TempDir
    static Path temporaryDirectory;

    @MockitoBean
    Driver driver;
    @MockitoBean
    CodeGraph graph;
    @MockitoBean
    QdrantVectorStore vectors;
    @MockitoBean
    OllamaEmbeddingService embeddings;

    private final TestRestTemplate http;
    private final IndexPipeline pipeline;

    @Autowired
    FirstRunStartupTest(TestRestTemplate http, IndexPipeline pipeline) {
        this.http = http;
        this.pipeline = pipeline;
    }

    @DynamicPropertySource
    static void freshHome(DynamicPropertyRegistry properties) {
        // Override Spring's property only; never change the test JVM's real user.home.
        assertThat(temporaryDirectory.resolve("new-user")).doesNotExist();
        properties.add("user.home", () -> temporaryDirectory.resolve("new-user").toString());
    }

    @Test
    void startsWithMissingHomeAndCompletesFirstIndex() throws Exception {
        Path database = temporaryDirectory.resolve("new-user/.repograph/index.db");
        assertThat(database).isRegularFile();
        Path project = Files.createDirectory(temporaryDirectory.resolve("project"));
        Files.writeString(project.resolve("Greeting.java"), """
                package example;
                public class Greeting {
                    public String hello() { return "hello"; }
                }
                """);
        when(embeddings.embed(anyList())).thenAnswer(invocation -> invocation.<List<String>>getArgument(0)
                .stream().map(text -> new float[]{0.1f, 0.2f}).toList());

        var accepted = http.postForEntity("/api/v1/index/project?projectRoot={root}&lang=java", null,
                JsonNode.class, project.toString());
        assertThat(accepted.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

        await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
            var status = http.getForEntity("/api/v1/index/project/status?projectRoot={root}",
                    JsonNode.class, project.toString());
            assertThat(status.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(status.getBody().path("status").asText()).isEqualTo("done");
            assertThat(status.getBody().path("parsedFiles").asInt()).isEqualTo(1);
            assertThat(status.getBody().path("totalUnits").asInt()).isGreaterThan(0);
            assertThat(status.getBody().path("errors")).isEmpty();
            // A fresh store proves the result reached SQLite, rather than only the controller's memory.
            assertThat(new IndexHistoryStore(database.toString()).load(project.toString()))
                    .hasValueSatisfying(history -> assertThat(history.status()).isEqualTo("done"));
        });

        var unchanged = pipeline.index(project, IndexOptions.defaults());
        assertThat(unchanged.errors()).isEmpty();
        assertThat(unchanged.parsedFiles()).isZero();
        assertThat(unchanged.skippedFiles()).isEqualTo(1);
    }
}
