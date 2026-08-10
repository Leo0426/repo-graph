package com.repograph.advisory;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.advisory.LlmAdvisorySettings;
import com.repograph.core.advisory.LlmAdvisorySettingsService;
import com.repograph.core.architecture.ArchitectureEvidence;
import com.repograph.core.architecture.ArchitectureReviewInput;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * {@link OllamaArchitectureReviewModel} 的结构化 Ollama 契约测试。
 *
 * @author leolu
 */
class OllamaArchitectureReviewModelTest {

    @Test
    void reviewRequestsThreeToFiveStructuredCandidates() {
        LlmAdvisorySettingsService settings = mock(LlmAdvisorySettingsService.class);
        when(settings.current()).thenReturn(new LlmAdvisorySettings(
                true, "OLLAMA", "http://localhost:11434", "qwen3:8b", "2026-08-10T10:00:00Z"));
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        server.expect(once(), requestTo("http://localhost:11434/api/chat"))
                .andExpect(jsonPath("$.format.properties.candidates.minItems").value(3))
                .andExpect(jsonPath("$.messages[0].content").value(
                        org.hamcrest.Matchers.containsString("must use Simplified Chinese")))
                .andRespond(withSuccess(responseJson(), MediaType.APPLICATION_JSON));
        OllamaArchitectureReviewModel model = new OllamaArchitectureReviewModel(
                settings, restTemplate, new ObjectMapper());

        var response = model.review(new ArchitectureReviewInput(
                "project-a", "/repo", "2026-08-10T10:00:00Z", 70,
                List.of(new ArchitectureEvidence("ARCH-CC-1", "COMPLEXITY", "Foo.java:10", "CC=14"))));

        assertThat(response.observations()).containsExactly("观察");
        assertThat(response.candidates()).hasSize(3);
        assertThat(response.candidates().getFirst().citations()).containsExactly("ARCH-CC-1");
        assertThat(response.candidates().getFirst().cost()).isEqualTo("低");
        assertThat(response.candidates().getFirst().methodology()).isEqualTo("方法论映射：U1/U2");
        assertThat(response.missingInfo()).anyMatch(item -> item.contains("服务端已替换"));
        server.verify();
    }

    @Test
    void reviewStreamingForwardsDeltasAndParsesFinalDocument() throws Exception {
        LlmAdvisorySettingsService settings = mock(LlmAdvisorySettingsService.class);
        when(settings.current()).thenReturn(new LlmAdvisorySettings(
                true, "OLLAMA", "http://localhost:11434", "qwen3:8b", "2026-08-10T10:00:00Z"));
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        String content = reviewContent();
        int split = content.length() / 2;
        String ndjson = new ObjectMapper().writeValueAsString(new StreamChunk(
                new Message("assistant", content.substring(0, split)), false)) + "\n"
                + new ObjectMapper().writeValueAsString(new StreamChunk(
                new Message("assistant", content.substring(split)), true)) + "\n";
        server.expect(once(), requestTo("http://localhost:11434/api/chat"))
                .andExpect(jsonPath("$.stream").value(true))
                .andRespond(withSuccess(ndjson, MediaType.parseMediaType("application/x-ndjson")));
        OllamaArchitectureReviewModel model = new OllamaArchitectureReviewModel(
                settings, restTemplate, new ObjectMapper());
        StringBuilder streamed = new StringBuilder();

        var response = model.reviewStreaming(input(), streamed::append);

        assertThat(streamed).hasToString(content);
        assertThat(response.candidates()).hasSize(3);
        server.verify();
    }

    private static String responseJson() {
        try {
            return new ObjectMapper().writeValueAsString(new Response(
                    new Message("assistant", reviewContent())));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String reviewContent() {
        String candidate = """
                {"priority":1,"title":"候选","location":"Foo.java","problem":"复杂",
                "suggestion":"深化模块","benefit":"局部性","cost":"LOW","risk":"兼容",
                "methodology":"U1/U2","citations":["ARCH-CC-1"]}
                """.strip();
        String content = "{\"observations\":[\"观察\"],\"candidates\":["
                + candidate + "," + candidate.replace("\"priority\":1", "\"priority\":2") + ","
                + candidate.replace("\"priority\":1", "\"priority\":3") + "],\"missingInfo\":[]}";
        return content;
    }

    private static ArchitectureReviewInput input() {
        return new ArchitectureReviewInput(
                "project-a", "/repo", "2026-08-10T10:00:00Z", 70,
                List.of(new ArchitectureEvidence("ARCH-CC-1", "COMPLEXITY", "Foo.java:10", "CC=14")));
    }

    private record Message(String role, String content) {
    }

    private record Response(Message message) {
    }

    private record StreamChunk(Message message, boolean done) {
    }
}
