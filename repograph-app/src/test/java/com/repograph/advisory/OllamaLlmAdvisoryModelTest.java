package com.repograph.advisory;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.advisory.LlmAdvisoryEvidence;
import com.repograph.core.advisory.LlmAdvisoryRequest;
import com.repograph.core.finding.TriageVerdict;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import com.repograph.modelprovider.ModelHttpFixture;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * {@link OllamaLlmAdvisoryModel} 的 Ollama HTTP 边界契约测试。
 *
 * @author leolu
 */
class OllamaLlmAdvisoryModelTest {

    @TempDir
    Path tempDir;

    private ModelHttpFixture fixture;
    private RestTemplate restTemplate;
    private MockRestServiceServer server;
    private OllamaLlmAdvisoryModel model;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() throws Exception {
        fixture = new ModelHttpFixture(tempDir, "OLLAMA");
        restTemplate = new RestTemplate();
        server = MockRestServiceServer.bindTo(restTemplate).build();
        objectMapper = fixture.json;
        model = new OllamaLlmAdvisoryModel(fixture.gateway, restTemplate, objectMapper);
    }

    @AfterEach
    void close() { fixture.close(); }

    @Test
    void reviewRequestsJsonOnlyAdvisoryAndParsesStructuredResponse() throws Exception {
        String advisoryJson = objectMapper.writeValueAsString(Map.of(
                "suggestedVerdict", "NEEDS_REVIEW",
                "uncertainty", 0.25,
                "citations", List.of("C1"),
                "missingInfo", List.of("confirm runtime input origin")));
        String ollamaResponse = objectMapper.writeValueAsString(Map.of(
                "message", Map.of("role", "assistant", "content", advisoryJson),
                "prompt_eval_count", 100,
                "eval_count", 20));
        fixture.raw(200, ollamaResponse);

        var response = model.review(new LlmAdvisoryRequest(
                "req-1", "fp-1", TriageVerdict.TRUE_RISK,
                "CWE-78 command injection", List.of(new LlmAdvisoryEvidence(
                "C1", "src/App.java:10-12", "new ProcessBuilder(command)", true)),
                List.of("input origin unknown"), 2000));

        assertThat(response.suggestedVerdict()).isEqualTo(TriageVerdict.NEEDS_REVIEW);
        assertThat(response.uncertainty()).isEqualTo(0.25f);
        assertThat(response.citations()).containsExactly("C1");
        assertThat(response.usage().inputTokens()).isEqualTo(100);
        assertThat(response.usage().outputTokens()).isEqualTo(20);
        assertThat(fixture.request().path("format").path("type").asText()).isEqualTo("object");
        assertThat(fixture.request().path("format").path("properties").path("missingInfo")
                .path("type").asText()).isEqualTo("array");
        assertThat(fixture.request().toString()).contains("C1");
        server.verify();
    }

    @Test
    void reviewNormalizesScalarListFieldsReturnedByLocalModel() throws Exception {
        String advisoryJson = objectMapper.writeValueAsString(Map.of(
                "suggestedVerdict", "LIKELY_FALSE_POSITIVE",
                "uncertainty", 0.9,
                "citations", "C1",
                "missingInfo", "confirm runtime input origin"));
        String ollamaResponse = objectMapper.writeValueAsString(Map.of(
                "message", Map.of("role", "assistant", "content", advisoryJson),
                "prompt_eval_count", 100,
                "eval_count", 20));
        fixture.raw(200, ollamaResponse);

        var response = model.review(new LlmAdvisoryRequest(
                "req-1", "fp-1", TriageVerdict.TRUE_RISK,
                "CWE-78 command injection", List.of(new LlmAdvisoryEvidence(
                "C1", "src/App.java:10-12", "new ProcessBuilder(command)", true)),
                List.of("input origin unknown"), 2000));

        assertThat(response.suggestedVerdict()).isEqualTo(TriageVerdict.LIKELY_FALSE_POSITIVE);
        assertThat(response.citations()).containsExactly("C1");
        assertThat(response.missingInfo()).containsExactly("confirm runtime input origin");
        server.verify();
    }

    @Test
    void remoteProviderUsesConfiguredTokenPrices() throws Exception {
        var configured = fixture.providers.current();
        fixture.providers.save(configured.id(), new com.repograph.modelprovider.ModelProviderStore.ProviderInput(
                "Remote", "OPENAI", fixture.baseUrl(), "remote-model", true, "", false, 2000, 4096));
        assertThat(model.estimateCostUsd(1000, 2000)).isNaN();
        fixture.providers.save(configured.id(), new com.repograph.modelprovider.ModelProviderStore.ProviderInput(
                "Remote", "OPENAI", fixture.baseUrl(), "remote-model", true, "", false, 2000, 4096, 2.0, 8.0));
        // Conservative input bound includes serialization/prompt overhead; full configured output allowance is charged.
        assertThat(model.estimateCostUsd(1000, 2000)).isEqualTo(((6000 + 8192) * 2.0 + 4096 * 8.0) / 1000000);
        var longLocation = new LlmAdvisoryRequest("r", "fp", TriageVerdict.NEEDS_REVIEW, "summary",
                List.of(new LlmAdvisoryEvidence("C1", "长".repeat(10000), "", true)), List.of(), 2000);
        assertThat(model.estimateCostUsd(longLocation)).as("all serialized evidence counts toward cost").isGreaterThan(0.05);
        fixture.text("{\"suggestedVerdict\":\"NEEDS_REVIEW\",\"uncertainty\":0.5,\"citations\":[],\"missingInfo\":[]}");
        var response = model.review(new LlmAdvisoryRequest("r", "fp", TriageVerdict.NEEDS_REVIEW,
                "summary", List.of(), List.of(), 2000));
        assertThat(response.usage().estimatedCostUsd()).isEqualTo((100 * 2.0 + 20 * 8.0) / 1000000);
    }

    @Test
    void unpricedProviderCanReviewAndReportsUnknownCostInsteadOfFree() throws Exception {
        var configured = fixture.providers.current();
        fixture.providers.save(configured.id(), new com.repograph.modelprovider.ModelProviderStore.ProviderInput(
                "Remote", "OPENAI_COMPATIBLE", fixture.baseUrl(), "remote-model", true, "", false, 2000, 4096));
        fixture.text("{\"suggestedVerdict\":\"NEEDS_REVIEW\",\"uncertainty\":0.5,\"citations\":[],\"missingInfo\":[]}");
        var response = model.review(new LlmAdvisoryRequest("r", "fp", TriageVerdict.NEEDS_REVIEW,
                "summary", List.of(), List.of(), 2000));
        assertThat(response.suggestedVerdict()).isEqualTo(TriageVerdict.NEEDS_REVIEW);
        assertThat(response.usage().inputTokens()).isEqualTo(100);
        assertThat(objectMapper.readTree(objectMapper.writeValueAsBytes(response.usage()))
                .path("estimatedCostUsd").isNull()).isTrue();
    }

    @Test
    void requestSnapshotKeepsModelAndPricesWhenAdministratorChangesConfiguration() throws Exception {
        var snapshot = model.forRequest();
        var provider = fixture.providers.current();
        fixture.providers.save(provider.id(), new com.repograph.modelprovider.ModelProviderStore.ProviderInput(
                "Changed", "OPENAI", fixture.baseUrl(), "different-model", true, "", false, 2000, 4096));
        assertThat(model.estimateCostUsd(1000, 1000)).isNaN();
        assertThat(snapshot.estimateCostUsd(1000, 1000)).isZero();
        String content = objectMapper.writeValueAsString(Map.of("suggestedVerdict", "NEEDS_REVIEW",
                "uncertainty", 0.5, "citations", List.of(), "missingInfo", List.of()));
        fixture.raw(200, objectMapper.writeValueAsString(Map.of("message", Map.of("content", content))));
        snapshot.review(new LlmAdvisoryRequest("snapshot", "fp", TriageVerdict.NEEDS_REVIEW,
                "summary", List.of(), List.of(), 1000));
        assertThat(snapshot.model()).isEqualTo("test-model");
        assertThat(fixture.request().path("model").asText()).isEqualTo("test-model");
    }

    @Test
    void connectionTestDistinguishesReachableServerFromInstalledModel() {
        server.expect(once(), requestTo("http://localhost:11434/api/tags"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("""
                        {"models":[{"name":"qwen3:4b"},{"name":"qwen3:8b"}]}
                        """, MediaType.APPLICATION_JSON));

        OllamaConnectionStatus status = model.testConnection(
                "http://localhost:11434", "qwen3:8b");

        assertThat(status.reachable()).isTrue();
        assertThat(status.modelAvailable()).isTrue();
        assertThat(status.models()).containsExactly("qwen3:4b", "qwen3:8b");
        server.verify();
    }
}
