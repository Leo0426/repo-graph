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

    @org.junit.jupiter.api.io.TempDir java.nio.file.Path temporary;

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"OLLAMA", "OPENAI", "ANTHROPIC"})
    void reviewRequestsThreeToFiveStructuredCandidates(String protocol) throws Exception {
        try (var fixture = new com.repograph.modelprovider.ModelHttpFixture(temporary, protocol)) {
            fixture.text(reviewContent());
            var model = new OllamaArchitectureReviewModel(fixture.gateway, fixture.json);
            var response = model.review(input());
            assertThat(response.observations()).containsExactly("观察");
            assertThat(response.candidates()).hasSize(3);
            assertThat(response.candidates().getFirst().citations()).containsExactly("ARCH-CC-1");
            assertThat(response.candidates().getFirst().cost()).isEqualTo("低");
            assertThat(response.candidates().getFirst().methodology()).isEqualTo("方法论映射：U1/U2");
            assertThat(response.missingInfo()).anyMatch(item -> item.contains("服务端已替换"));
            assertThat(fixture.request().toString()).contains("must use Simplified Chinese", "minItems");
        }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"OLLAMA", "OPENAI", "ANTHROPIC"})
    void reviewStreamingForwardsDeltasAndParsesFinalDocument(String protocol) throws Exception {
        try (var fixture = new com.repograph.modelprovider.ModelHttpFixture(temporary, protocol)) {
            String content = reviewContent();
            int split = content.length() / 2;
            String wire = chunk(protocol, content.substring(0, split), false)
                    + chunk(protocol, content.substring(split), true);
            fixture.raw(200, wire);
            var model = new OllamaArchitectureReviewModel(fixture.gateway, fixture.json);
            StringBuilder streamed = new StringBuilder();
            var response = model.reviewStreaming(input(), streamed::append);
            assertThat(streamed).hasToString(content);
            assertThat(response.candidates()).hasSize(3);
            assertThat(fixture.request().path("stream").asBoolean()).isTrue();
        }
    }

    private String chunk(String protocol, String content, boolean done) throws Exception {
        String text = new ObjectMapper().writeValueAsString(content);
        return switch (protocol) {
            case "OLLAMA" -> "{\"message\":{\"content\":" + text + "},\"done\":" + done + "}\n";
            case "OPENAI" -> "data: {\"choices\":[{\"delta\":{\"content\":" + text + "}}]}\n\n"
                    + (done ? "data: [DONE]\n\n" : "");
            default -> "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\","
                    + "\"text\":" + text + "}}\n\n" + (done ? "data: {\"type\":\"message_stop\"}\n\n" : "");
        };
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
