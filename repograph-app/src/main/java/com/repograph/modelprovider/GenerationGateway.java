package com.repograph.modelprovider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.advisory.LlmModelException;
import com.repograph.core.modelprovider.ModelProvider;
import com.repograph.core.modelprovider.ModelProvider.Protocol;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/** Shared generation transport with bounded output and safe errors. @author leolu */
@Component
public class GenerationGateway {
    private static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    private final ModelProviderStore providers;
    private final ObjectMapper json;

    /** Connects the selected persistent configuration to protocol-independent callers. */
    public GenerationGateway(ModelProviderStore providers, ObjectMapper json) {
        this.providers = providers;
        this.json = json;
    }

    /** Returns credential-free current configuration. */
    public ModelProvider current() { return providers.current(); }

    /** Completes text using one immutable configuration snapshot for the whole request. */
    public Completion complete(String system, String user, Map<String, Object> schema, Consumer<String> deltas) {
        return session().complete(system, user, schema, deltas);
    }

    /** Captures configuration and credentials for one higher-level operation, including any retries. */
    public Session session() { return new Session(providers.resolveCurrent()); }

    /** Request-scoped generation handle; credentials remain private and cannot be serialized. */
    public final class Session {
        private final ModelProviderStore.ResolvedProvider resolved;
        private Session(ModelProviderStore.ResolvedProvider resolved) { this.resolved = resolved; }

        /** Returns the captured public configuration. */
        public ModelProvider configuration() { return resolved.configuration(); }

        /** Uses the captured provider rather than a later administrator selection. */
        public Completion complete(String system, String user, Map<String, Object> schema, Consumer<String> deltas) {
            var provider = configuration();
            if (!provider.enabled()) throw new LlmModelException("Generation provider is disabled", false);
            return invoke(resolved, system, user, schema, deltas, provider.maxOutputTokens());
        }
    }

    /** Performs one small generation request with a saved profile without changing selection or enablement. */
    public ConnectionTest testConnection(String id) {
        var resolved = providers.resolve(id);
        try {
            invoke(resolved, "You are testing a model connection.", "Reply with OK.", Map.of(), null,
                    Math.min(128, resolved.configuration().maxOutputTokens()));
            return new ConnectionTest(true, "连接与模型调用成功。");
        } catch (LlmModelException error) {
            return new ConnectionTest(false, error.getMessage());
        }
    }

    /** Safe connection-test outcome, excluding upstream content. */
    public record ConnectionTest(boolean connected, String message) { }

    private Completion invoke(ModelProviderStore.ResolvedProvider resolved, String system, String user,
                              Map<String, Object> schema, Consumer<String> deltas, int outputLimit) {
        if (Thread.currentThread().isInterrupted()) {
            throw new LlmModelException("Model request was cancelled", false);
        }
        // JDK virtual-thread socket I/O is interruptible; platform callers wait on an interruptible future.
        var task = new java.util.concurrent.FutureTask<>(
                () -> exchange(resolved, system, user, schema, deltas, outputLimit));
        Thread.ofVirtual().name("repograph-provider-request").start(task);
        try {
            return task.get(resolved.configuration().timeoutMillis(), java.util.concurrent.TimeUnit.MILLISECONDS);
        } catch (InterruptedException cancelled) {
            Thread.currentThread().interrupt();
            throw new LlmModelException("Model request was cancelled", false);
        } catch (java.util.concurrent.TimeoutException timeout) {
            throw new LlmModelException("Model request exceeded its configured timeout", true);
        } catch (java.util.concurrent.ExecutionException failed) {
            if (failed.getCause() instanceof LlmModelException safe) throw safe;
            throw new LlmModelException("Model request failed", false);
        } finally {
            if (!task.isDone()) task.cancel(true);
        }
    }

    private Completion exchange(ModelProviderStore.ResolvedProvider resolved, String system, String user,
                                Map<String, Object> schema, Consumer<String> deltas, int outputLimit) {
        var provider = resolved.configuration();
        HttpURLConnection connection = null;
        try {
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("model", provider.model());
            request.put("stream", deltas != null);
            String endpoint;
            if (!schema.isEmpty()) system += "\nReturn JSON matching this schema: " + json.writeValueAsString(schema);
            if (provider.protocol() == Protocol.ANTHROPIC) {
                endpoint = "/messages";
                request.put("system", system);
                request.put("messages", List.of(Map.of("role", "user", "content", user)));
                request.put("max_tokens", outputLimit);
            } else {
                endpoint = "/chat/completions";
                request.put("messages", List.of(Map.of("role", "system", "content", system),
                        Map.of("role", "user", "content", user)));
                if (provider.protocol() == Protocol.OLLAMA) {
                    endpoint = "/api/chat";
                    request.put("options", Map.of("temperature", 0, "num_predict", outputLimit));
                    if (!schema.isEmpty()) request.put("format", schema);
                } else {
                    request.put(provider.protocol() == Protocol.OPENAI ? "max_completion_tokens" : "max_tokens",
                            outputLimit);
                }
            }
            byte[] body = json.writeValueAsBytes(request);
            if (body.length > MAX_RESPONSE_BYTES) throw new LlmModelException("Model input is too large", false);
            connection = (HttpURLConnection) URI.create(provider.baseUrl() + endpoint)
                    .toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(provider.timeoutMillis());
            connection.setReadTimeout(provider.timeoutMillis());
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            if (provider.protocol() == Protocol.ANTHROPIC) {
                connection.setRequestProperty("anthropic-version", "2023-06-01");
                if (!resolved.apiKey().isEmpty()) connection.setRequestProperty("x-api-key", resolved.apiKey());
            } else if (!resolved.apiKey().isEmpty()) {
                connection.setRequestProperty("Authorization", "Bearer " + resolved.apiKey());
            }
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            try (var output = connection.getOutputStream()) { output.write(body); }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new LlmModelException("Model endpoint returned HTTP " + status, status == 429 || status >= 500);
            }
            if (deltas != null) {
                try (InputStream input = connection.getInputStream()) {
                    return readStream(input, provider, deltas);
                }
            }
            JsonNode response;
            try (InputStream input = connection.getInputStream()) {
                byte[] bytes = input.readNBytes(MAX_RESPONSE_BYTES + 1);
                if (bytes.length > MAX_RESPONSE_BYTES) throw new LlmModelException("Model output is too large", false);
                response = json.readTree(bytes);
            }
            if (response == null || response.has("error")) throw new LlmModelException("Invalid model response", false);
            String text;
            int inputTokens;
            int outputTokens;
            if (provider.protocol() == Protocol.ANTHROPIC) {
                rejectTruncation(response.path("stop_reason").asText());
                StringBuilder content = new StringBuilder();
                for (JsonNode block : response.path("content")) {
                    if ("text".equals(block.path("type").asText())) content.append(block.path("text").asText(""));
                }
                text = content.toString();
                inputTokens = nonnegative(response.path("usage").path("input_tokens"));
                outputTokens = nonnegative(response.path("usage").path("output_tokens"));
            } else if (provider.protocol() == Protocol.OLLAMA) {
                rejectTruncation(response.path("done_reason").asText());
                text = response.path("message").path("content").asText("");
                inputTokens = nonnegative(response.path("prompt_eval_count"));
                outputTokens = nonnegative(response.path("eval_count"));
            } else {
                rejectTruncation(response.path("choices").path(0).path("finish_reason").asText());
                text = response.path("choices").path(0).path("message").path("content").asText("");
                inputTokens = nonnegative(response.path("usage").path("prompt_tokens"));
                outputTokens = nonnegative(response.path("usage").path("completion_tokens"));
            }
            if (text.isBlank()) throw new LlmModelException("Model returned no text", false);
            return new Completion(text, inputTokens, outputTokens, provider);
        } catch (IOException error) {
            // Provider error bodies and parser exceptions may contain credentials or source; do not chain them.
            throw new LlmModelException("Model endpoint is unavailable or returned invalid JSON", true);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private Completion readStream(InputStream input, ModelProvider provider, Consumer<String> consumer)
            throws IOException {
        var reader = new java.io.InputStreamReader(input, StandardCharsets.UTF_8);
        StringBuilder line = new StringBuilder();
        StringBuilder event = new StringBuilder();
        StreamState state = new StreamState(provider, consumer);
        int character;
        int count = 0;
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.MILLISECONDS
                .toNanos(provider.timeoutMillis());
        while (!state.done && (character = reader.read()) != -1) {
            if (++count > MAX_RESPONSE_BYTES || line.length() > 262144 || event.length() > 262144) {
                throw new LlmModelException("Model stream is too large", false);
            }
            if (Thread.currentThread().isInterrupted() || System.nanoTime() > deadline) {
                throw new LlmModelException("Model stream timed out or was cancelled", true);
            }
            if (character == '\n') {
                String value = line.toString();
                if (value.endsWith("\r")) value = value.substring(0, value.length() - 1);
                line.setLength(0);
                if (provider.protocol() == Protocol.OLLAMA) {
                    if (!value.isBlank()) state.accept(value);
                } else if (value.isEmpty()) {
                    if (!event.isEmpty()) {
                        state.accept(event.toString());
                        event.setLength(0);
                    }
                } else if (value.startsWith("data:")) {
                    if (!event.isEmpty()) event.append('\n');
                    String data = value.substring(5);
                    event.append(data.startsWith(" ") ? data.substring(1) : data);
                }
            } else {
                line.append((char) character);
            }
        }
        if (!state.done && provider.protocol() == Protocol.OLLAMA && !line.isEmpty()) state.accept(line.toString());
        if (!state.done) throw new LlmModelException("Model stream ended before completion", true);
        if (state.text.isEmpty()) throw new LlmModelException("Model returned no text", false);
        return new Completion(state.text.toString(), state.inputTokens, state.outputTokens, provider);
    }

    private final class StreamState {
        private final ModelProvider provider;
        private final Consumer<String> consumer;
        private final StringBuilder text = new StringBuilder();
        private int inputTokens;
        private int outputTokens;
        private boolean done;

        private StreamState(ModelProvider provider, Consumer<String> consumer) {
            this.provider = provider;
            this.consumer = consumer;
        }

        private void accept(String data) throws IOException {
            if ((provider.protocol() == Protocol.OPENAI || provider.protocol() == Protocol.OPENAI_COMPATIBLE)
                    && "[DONE]".equals(data)) {
                done = true;
                return;
            }
            JsonNode chunk = json.readTree(data);
            if (chunk == null || chunk.has("error") || "error".equals(chunk.path("type").asText())) {
                throw new LlmModelException("Model stream reported an error", true);
            }
            String delta = "";
            switch (provider.protocol()) {
                case OLLAMA -> {
                    delta = chunk.path("message").path("content").asText("");
                    done = chunk.path("done").asBoolean();
                    rejectTruncation(chunk.path("done_reason").asText());
                    inputTokens = Math.max(inputTokens, nonnegative(chunk.path("prompt_eval_count")));
                    outputTokens = Math.max(outputTokens, nonnegative(chunk.path("eval_count")));
                }
                case OPENAI, OPENAI_COMPATIBLE -> {
                    delta = chunk.path("choices").path(0).path("delta").path("content").asText("");
                    rejectTruncation(chunk.path("choices").path(0).path("finish_reason").asText());
                    inputTokens = Math.max(inputTokens, nonnegative(chunk.path("usage").path("prompt_tokens")));
                    outputTokens = Math.max(outputTokens, nonnegative(chunk.path("usage").path("completion_tokens")));
                }
                case ANTHROPIC -> {
                    String type = chunk.path("type").asText();
                    if ("content_block_delta".equals(type)
                            && "text_delta".equals(chunk.path("delta").path("type").asText())) {
                        delta = chunk.path("delta").path("text").asText("");
                    }
                    if ("message_start".equals(type)) {
                        inputTokens = nonnegative(chunk.path("message").path("usage").path("input_tokens"));
                    }
                    if ("message_delta".equals(type)) {
                        outputTokens = nonnegative(chunk.path("usage").path("output_tokens"));
                        rejectTruncation(chunk.path("delta").path("stop_reason").asText());
                    }
                    done = "message_stop".equals(type);
                }
            }
            if (!delta.isEmpty()) {
                text.append(delta);
                consumer.accept(delta);
            }
        }
    }

    private static void rejectTruncation(String reason) {
        if (java.util.Set.of("length", "max_tokens", "content_filter", "aborted",
                "insufficient_system_resource", "tool_calls", "tool_use").contains(reason)) {
            throw new LlmModelException("Model output was truncated, filtered or incomplete", false);
        }
    }

    private static int nonnegative(JsonNode value) { return Math.max(0, value.asInt(0)); }

    /** Generated text and reported token counts, tied to the configuration used for this call. */
    public record Completion(String text, int inputTokens, int outputTokens, ModelProvider provider) { }
}
