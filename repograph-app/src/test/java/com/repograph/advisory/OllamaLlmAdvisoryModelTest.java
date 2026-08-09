package com.repograph.advisory;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.advisory.LlmAdvisoryEvidence;
import com.repograph.core.advisory.LlmAdvisoryRequest;
import com.repograph.core.finding.TriageVerdict;
import org.junit.jupiter.api.BeforeEach;
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

    private LlmAdvisorySettingsStore settingsStore;
    private RestTemplate restTemplate;
    private MockRestServiceServer server;
    private OllamaLlmAdvisoryModel model;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        settingsStore = new LlmAdvisorySettingsStore(
                tempDir.resolve("settings.db").toString(),
                false, "http://localhost:11434", "qwen3:8b");
        settingsStore.update(true, "http://localhost:11434", "qwen3:8b", "2026-08-09T09:00:00Z");
        restTemplate = new RestTemplate();
        server = MockRestServiceServer.bindTo(restTemplate).build();
        objectMapper = new ObjectMapper();
        model = new OllamaLlmAdvisoryModel(settingsStore, restTemplate, objectMapper);
    }

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
        server.expect(once(), requestTo("http://localhost:11434/api/chat"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("C1")))
                .andRespond(withSuccess(ollamaResponse, MediaType.APPLICATION_JSON));

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
        server.verify();
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
