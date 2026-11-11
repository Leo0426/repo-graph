package com.repograph.modelprovider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/** Real HTTP protocol fixtures, without external model calls. @author leolu */
class GenerationGatewayTest {
    @TempDir Path temporary;
    private final ObjectMapper json = new ObjectMapper();

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"OPENAI", "OPENAI_COMPATIBLE"})
    void sendsOpenAiChatCompletionsWithSavedCredentialsAndReturnsUsage(String protocol) throws Exception {
        var received = new AtomicReference<JsonNode>();
        var authorization = new AtomicReference<String>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/gateway/v1/chat/completions", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            received.set(json.readTree(exchange.getRequestBody()));
            byte[] bytes = """
                    {"choices":[{"message":{"content":"A grounded answer"},"finish_reason":"stop"}],
                     "usage":{"prompt_tokens":21,"completion_tokens":7}}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try {
            var store = store(server, protocol);
            var gateway = new GenerationGateway(store, json);
            var response = gateway.complete("Trusted system", "Untrusted source", Map.of(), null);
            assertThat(response.text()).isEqualTo("A grounded answer");
            assertThat(response.inputTokens()).isEqualTo(21);
            assertThat(response.outputTokens()).isEqualTo(7);
            assertThat(authorization.get()).isEqualTo("Bearer fixture-secret");
            assertThat(received.get().path("model").asText()).isEqualTo("fixture-model");
            String limitField = protocol.equals("OPENAI") ? "max_completion_tokens" : "max_tokens";
            String otherField = protocol.equals("OPENAI") ? "max_tokens" : "max_completion_tokens";
            assertThat(received.get().path(limitField).asInt()).isEqualTo(2048);
            assertThat(received.get().has(otherField)).isFalse();
            assertThat(received.get().path("stream").asBoolean()).isFalse();
            assertThat(received.get().path("messages").get(0).path("role").asText()).isEqualTo("system");
        } finally { server.stop(0); }
    }

    @Test
    void anthropicUsesSystemFieldAndTextBlocksWithoutExposingThinking() throws Exception {
        var received = new AtomicReference<JsonNode>();
        var key = new AtomicReference<String>();
        var version = new AtomicReference<String>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/gateway/v1/messages", exchange -> {
            key.set(exchange.getRequestHeaders().getFirst("x-api-key"));
            version.set(exchange.getRequestHeaders().getFirst("anthropic-version"));
            received.set(json.readTree(exchange.getRequestBody()));
            byte[] bytes = """
                    {"content":[{"type":"thinking","thinking":"hidden reasoning"},
                    {"type":"text","text":"First "},{"type":"text","text":"answer"}],
                    "stop_reason":"end_turn","usage":{"input_tokens":11,"output_tokens":4}}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try {
            var gateway = new GenerationGateway(store(server, "ANTHROPIC"), json);
            var response = gateway.complete("Trusted system", "User evidence", Map.of(), null);
            assertThat(response.text()).isEqualTo("First answer");
            assertThat(response.inputTokens()).isEqualTo(11);
            assertThat(response.outputTokens()).isEqualTo(4);
            assertThat(key.get()).isEqualTo("fixture-secret");
            assertThat(version.get()).isEqualTo("2023-06-01");
            assertThat(received.get().path("system").asText()).isEqualTo("Trusted system");
            assertThat(received.get().path("messages")).hasSize(1);
            assertThat(received.get().path("messages").path(0).path("role").asText()).isEqualTo("user");
            assertThat(received.get().path("max_tokens").asInt()).isEqualTo(2048);
        } finally { server.stop(0); }
    }

    @Test
    void ollamaKeepsNativeSchemaAndTokenLimits() throws Exception {
        var received = new AtomicReference<JsonNode>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/gateway/v1/api/chat", exchange -> {
            received.set(json.readTree(exchange.getRequestBody()));
            byte[] bytes = """
                    {"message":{"content":"Local answer"},"done":true,"prompt_eval_count":13,"eval_count":5}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try {
            var gateway = new GenerationGateway(store(server, "OLLAMA"), json);
            var response = gateway.complete("System", "User", Map.of("type", "object"), null);
            assertThat(response.text()).isEqualTo("Local answer");
            assertThat(response.inputTokens()).isEqualTo(13);
            assertThat(response.outputTokens()).isEqualTo(5);
            assertThat(received.get().path("format").path("type").asText()).isEqualTo("object");
            assertThat(received.get().path("options").path("num_predict").asInt()).isEqualTo(2048);
        } finally { server.stop(0); }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.EnumSource(com.repograph.core.modelprovider.ModelProvider.Protocol.class)
    void streamsTextBeforeTheServerFinishesAndRequiresProtocolCompletion(
            com.repograph.core.modelprovider.ModelProvider.Protocol protocol) throws Exception {
        var firstDelivered = new java.util.concurrent.CountDownLatch(1);
        var streamed = new AtomicReference<Boolean>(false);
        var incremental = new AtomicReference<Boolean>(false);
        String endpoint = switch (protocol) {
            case OLLAMA -> "/api/chat";
            case OPENAI, OPENAI_COMPATIBLE -> "/chat/completions";
            case ANTHROPIC -> "/messages";
        };
        String first = switch (protocol) {
            case OLLAMA -> "{\"message\":{\"content\":\"Hello\"},\"done\":false}\n";
            case OPENAI, OPENAI_COMPATIBLE -> "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n";
            case ANTHROPIC -> "event: content_block_delta\ndata: {\"type\":\"content_block_delta\","
                    + "\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hidden\"}}\n\n"
                    + "event: content_block_delta\ndata: {\"type\":\"content_block_delta\","
                    + "\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n";
        };
        String last = switch (protocol) {
            case OLLAMA -> "{\"message\":{\"content\":\" world\"},\"done\":true,"
                    + "\"prompt_eval_count\":12,\"eval_count\":6}\n";
            case OPENAI, OPENAI_COMPATIBLE -> "data: {\"choices\":[{\"delta\":{\"content\":\" world\"},"
                    + "\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
            case ANTHROPIC -> "event: content_block_delta\ndata: {\"type\":\"content_block_delta\","
                    + "\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\n"
                    + "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
        };
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/gateway/v1" + endpoint, exchange -> {
            streamed.set(json.readTree(exchange.getRequestBody()).path("stream").asBoolean());
            exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
            exchange.sendResponseHeaders(200, 0);
            exchange.getResponseBody().write(first.getBytes(StandardCharsets.UTF_8));
            exchange.getResponseBody().flush();
            try { incremental.set(firstDelivered.await(1, java.util.concurrent.TimeUnit.SECONDS)); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            exchange.getResponseBody().write(last.getBytes(StandardCharsets.UTF_8));
            exchange.close();
        });
        server.start();
        try {
            var gateway = new GenerationGateway(store(server, protocol.name()), json);
            var deltas = new java.util.ArrayList<String>();
            var result = gateway.complete("System", "User", Map.of(), delta -> {
                deltas.add(delta);
                firstDelivered.countDown();
            });
            assertThat(streamed.get()).isTrue();
            assertThat(incremental.get()).isTrue();
            assertThat(deltas).containsExactly("Hello", " world");
            assertThat(result.text()).isEqualTo("Hello world");
        } finally { server.stop(0); }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"length", "aborted", "insufficient_system_resource", "tool_calls"})
    void truncatedCompletionIsNotAcceptedAsAValidAnswer(String reason) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/gateway/v1/chat/completions", exchange -> {
            exchange.getRequestBody().readAllBytes();
            byte[] bytes = """
                    {"choices":[{"message":{"content":"incomplete answer"},"finish_reason":"%s"}]}
                    """.formatted(reason).getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try {
            var gateway = new GenerationGateway(store(server, "OPENAI_COMPATIBLE"), json);
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> gateway.complete("System", "User", Map.of(), null))
                    .isInstanceOf(com.repograph.core.advisory.LlmModelException.class)
                    .hasMessageContaining("truncated");
        } finally { server.stop(0); }
    }

    @Test
    void explicitConnectionTestUsesSavedProfileWithoutEnablingItOrChangingSelection() throws Exception {
        try (var fixture = new ModelHttpFixture(temporary, "ANTHROPIC")) {
            fixture.text("OK");
            fixture.disable();
            String selected = fixture.providers.current().id();
            var result = fixture.gateway.testConnection(selected);
            assertThat(result.connected()).isTrue();
            assertThat(fixture.request().path("max_tokens").asInt()).isEqualTo(128);
            assertThat(fixture.providers.current().id()).isEqualTo(selected);
            assertThat(fixture.providers.current().enabled()).isFalse();
            fixture.raw(401, "private upstream error including fixture-secret");
            var failure = fixture.gateway.testConnection(selected);
            assertThat(failure.connected()).isFalse();
            assertThat(failure.message()).contains("HTTP 401").doesNotContain("fixture-secret");
        }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"redirect", "http-error", "stream-error", "unfinished", "oversized"})
    void rejectsUnsafeOrIncompleteResponsesWithoutLeakingUpstreamContent(String scenario) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var redirected = new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/redirect-target", exchange -> {
            redirected.incrementAndGet(); exchange.sendResponseHeaders(200, -1); exchange.close();
        });
        server.createContext("/gateway/v1/chat/completions", exchange -> {
            exchange.getRequestBody().readAllBytes();
            String body = switch (scenario) {
                case "stream-error" -> "data: {\"error\":{\"message\":\"private-upstream-source\"}}\n\n";
                case "unfinished" -> "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n";
                case "oversized" -> "x".repeat(2 * 1024 * 1024 + 1);
                default -> "private-upstream-source fixture-secret";
            };
            int status = scenario.equals("redirect") ? 302 : scenario.equals("http-error") ? 401 : 200;
            exchange.getResponseHeaders().set("Location", "/redirect-target");
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            try { exchange.getResponseBody().write(bytes); } finally { exchange.close(); }
        });
        server.start();
        try {
            var gateway = new GenerationGateway(store(server, "OPENAI"), json);
            boolean streaming = scenario.equals("stream-error") || scenario.equals("unfinished");
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> gateway.complete("System", "User", Map.of(),
                    streaming ? delta -> { } : null))
                    .isInstanceOf(com.repograph.core.advisory.LlmModelException.class)
                    .satisfies(error -> {
                        assertThat(error.getMessage()).doesNotContain("private-upstream-source", "fixture-secret");
                        assertThat(error.getCause()).isNull();
                    });
            assertThat(redirected.get()).isZero();
        } finally { server.stop(0); }
    }

    private ModelProviderStore store(HttpServer server, String protocol) {
        var store = new ModelProviderStore(temporary.resolve("providers.db").toString(), "", false,
                "http://localhost:11434", "unused");
        var saved = store.save(null, new ModelProviderStore.ProviderInput("Gateway", protocol,
                "http://127.0.0.1:" + server.getAddress().getPort() + "/gateway/v1", "fixture-model",
                true, "fixture-secret", false, 2000, 2048));
        store.select(saved.id());
        return store;
    }
}
