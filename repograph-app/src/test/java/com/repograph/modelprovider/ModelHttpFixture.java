package com.repograph.modelprovider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/** Real HTTP fixture shared by generation-adapter contract tests. @author leolu */
public final class ModelHttpFixture implements AutoCloseable {
    /** Fixture JSON mapper. */
    public final ObjectMapper json = new ObjectMapper();
    /** Real persistent provider registry. */
    public final ModelProviderStore providers;
    /** Real generation transport. */
    public final GenerationGateway gateway;
    /** Requests received at the external boundary. */
    public final AtomicInteger requests = new AtomicInteger();
    private final HttpServer server;
    private volatile String response = "{}";
    private volatile int status = 200;
    private volatile JsonNode request;

    /** Creates an isolated provider and HTTP listener. */
    public ModelHttpFixture(Path directory, String protocol) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requests.incrementAndGet();
            byte[] input = exchange.getRequestBody().readAllBytes();
            request = input.length == 0 ? json.createObjectNode() : json.readTree(input);
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        providers = new ModelProviderStore(directory.resolve("model.db").toString(), "", true, baseUrl(), "local");
        var saved = providers.save(null, new ModelProviderStore.ProviderInput("Fixture", protocol, baseUrl(),
                "test-model", true, "", false, 2000, 4096));
        providers.select(saved.id());
        gateway = new GenerationGateway(providers, json);
    }

    /** Returns the loopback endpoint. */
    public String baseUrl() { return "http://127.0.0.1:" + server.getAddress().getPort(); }

    /** Prepares a native text completion with known usage. */
    public void text(String text) throws IOException {
        response = switch (providers.current().protocol()) {
            case OLLAMA -> json.writeValueAsString(Map.of("message", Map.of("content", text),
                    "prompt_eval_count", 100, "eval_count", 20));
            case OPENAI, OPENAI_COMPATIBLE -> json.writeValueAsString(Map.of("choices", java.util.List.of(
                    Map.of("message", Map.of("content", text), "finish_reason", "stop")),
                    "usage", Map.of("prompt_tokens", 100, "completion_tokens", 20)));
            case ANTHROPIC -> json.writeValueAsString(Map.of("content", java.util.List.of(
                    Map.of("type", "text", "text", text)), "usage", Map.of("input_tokens", 100, "output_tokens", 20)));
        };
    }

    /** Supplies a raw status/body, including SSE fixtures. */
    public void raw(int status, String body) { this.status = status; this.response = body; }

    /** Returns the last request body received by the server. */
    public JsonNode request() { return request; }

    /** Disables the selected provider without changing the selected identity. */
    public void disable() {
        var provider = providers.current();
        providers.save(provider.id(), new ModelProviderStore.ProviderInput(provider.name(), provider.protocol().name(),
                provider.baseUrl(), provider.model(), false, null, false, 2000, 4096));
    }

    @Override public void close() { server.stop(0); }
}
