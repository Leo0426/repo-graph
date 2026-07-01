package com.repograph.vector.embedding;

import com.repograph.core.vector.EmbeddingException;
import com.repograph.vector.config.OllamaProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * {@link OllamaEmbeddingService} 单元测试，使用 {@link MockRestServiceServer} 模拟 Ollama HTTP 响应。
 *
 * @author leolu
 * @since 0.1.0
 */
class OllamaEmbeddingServiceTest {

    private static final String BASE_URL = "http://localhost:11434";
    private static final String MODEL = "nomic-embed-code";

    private OllamaEmbeddingService service;
    private MockRestServiceServer mockServer;

    @BeforeEach
    void setUp() {
        OllamaProperties props = new OllamaProperties(BASE_URL, MODEL, 30);
        RestTemplate restTemplate = new RestTemplate();
        mockServer = MockRestServiceServer.createServer(restTemplate);
        service = new OllamaEmbeddingService(props, restTemplate);
    }

    // ── embed() ───────────────────────────────────────────────────────────────

    @Test
    void embed_emptyInput_returnsEmptyList() {
        List<float[]> result = service.embed(List.of());
        assertThat(result).isEmpty();
        mockServer.verify(); // no HTTP calls expected
    }

    @Test
    void embed_nullInput_returnsEmptyList() {
        List<float[]> result = service.embed(null);
        assertThat(result).isEmpty();
    }

    @Test
    void embed_singleText_returnsVector() {
        mockServer.expect(requestTo(BASE_URL + "/api/embed"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess(
                        "{\"embeddings\":[[0.1,0.2,0.3]]}",
                        MediaType.APPLICATION_JSON));

        List<float[]> result = service.embed(List.of("hello world"));

        assertThat(result).hasSize(1);
        assertThat(result.get(0)).containsExactly(0.1f, 0.2f, 0.3f);
        mockServer.verify();
    }

    @Test
    void embed_multipleBatchedTexts_callsOncePerBatch() {
        // 35 texts → 2 batches (32 + 3), but for simplicity test with 2 texts in 1 batch
        mockServer.expect(requestTo(BASE_URL + "/api/embed"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess(
                        "{\"embeddings\":[[0.1,0.2],[0.3,0.4]]}",
                        MediaType.APPLICATION_JSON));

        List<float[]> result = service.embed(List.of("text1", "text2"));

        assertThat(result).hasSize(2);
        assertThat(result.get(0)).containsExactly(0.1f, 0.2f);
        assertThat(result.get(1)).containsExactly(0.3f, 0.4f);
        mockServer.verify();
    }

    @Test
    void embed_serverError_throwsEmbeddingException() {
        mockServer.expect(requestTo(BASE_URL + "/api/embed"))
                .andRespond(withServerError());

        assertThatThrownBy(() -> service.embed(List.of("hello")))
                .isInstanceOf(EmbeddingException.class)
                .hasMessageContaining(BASE_URL);
    }

    @Test
    void embed_connectionRefused_throwsEmbeddingException() {
        OllamaProperties badProps = new OllamaProperties("http://localhost:9", MODEL, 1);
        RestTemplate restTemplate = new RestTemplate();
        OllamaEmbeddingService badService = new OllamaEmbeddingService(badProps, restTemplate);

        assertThatThrownBy(() -> badService.embed(List.of("hello")))
                .isInstanceOf(EmbeddingException.class);
    }

    @Test
    void embed_responseWithoutEmbeddingsField_throwsEmbeddingException() {
        // Ollama responds with {} — no embeddings key → embeddings field is null
        mockServer.expect(requestTo(BASE_URL + "/api/embed"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> service.embed(List.of("hello")))
                .isInstanceOf(EmbeddingException.class)
                .hasMessageContaining("null response");
    }

    // ── healthCheck() ─────────────────────────────────────────────────────────

    @Test
    void embed_moreThanBatchSize_callsApiInTwoBatches() {
        // 33 texts → batch[0..31] (32 items) + batch[32] (1 item) → 2 HTTP calls
        mockServer.expect(requestTo(BASE_URL + "/api/embed")).andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess(embeddingsJson(32), MediaType.APPLICATION_JSON));
        mockServer.expect(requestTo(BASE_URL + "/api/embed")).andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("{\"embeddings\":[[0.9,0.8]]}", MediaType.APPLICATION_JSON));

        List<float[]> result = service.embed(Collections.nCopies(33, "test text"));

        assertThat(result).hasSize(33);
        assertThat(result.get(32)).containsExactly(0.9f, 0.8f);
        mockServer.verify();
    }

    // ── healthCheck() ─────────────────────────────────────────────────────────

    @Test
    void healthCheck_success_doesNotThrow() {
        mockServer.expect(requestTo(BASE_URL + "/api/tags"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("{\"models\":[]}", MediaType.APPLICATION_JSON));

        service.healthCheck(); // should not throw

        mockServer.verify();
    }

    @Test
    void healthCheck_serverError_throwsEmbeddingException() {
        mockServer.expect(requestTo(BASE_URL + "/api/tags"))
                .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));

        assertThatThrownBy(() -> service.healthCheck())
                .isInstanceOf(EmbeddingException.class)
                .hasMessageContaining("Ollama service is not available");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static String embeddingsJson(int count) {
        var sb = new StringBuilder("{\"embeddings\":[");
        for (int i = 0; i < count; i++) {
            if (i > 0) sb.append(",");
            sb.append("[0.1,0.2]");
        }
        return sb.append("]}").toString();
    }
}
