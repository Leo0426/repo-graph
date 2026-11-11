package com.repograph.modelprovider;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.repograph.core.modelprovider.ModelProvider.Protocol;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.TreeSet;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Read-only model discovery with bounded transport and credential-free errors. @author leolu */
@Service
public class ModelCatalog {
    private static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    private final ModelProviderStore providers;
    private final ObjectMapper json;

    /** Creates discovery using the same draft validation and secret handling as saved providers. */
    public ModelCatalog(ModelProviderStore providers, ObjectMapper json) {
        this.providers = providers;
        this.json = json;
    }

    /** Lists models without saving, selecting, enabling or invoking generation; total wait is bounded. */
    public List<String> list(ModelProviderStore.CatalogInput input) {
        var connection = providers.resolveCatalog(input);
        if (Thread.currentThread().isInterrupted()) throw failure("模型列表获取已取消");
        var task = new FutureTask<>(() -> fetch(connection));
        Thread.ofVirtual().name("repograph-model-discovery").start(task);
        try {
            return task.get(connection.timeoutMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException cancelled) {
            Thread.currentThread().interrupt();
            throw failure("模型列表获取已取消");
        } catch (TimeoutException timeout) {
            throw failure("模型列表获取超时，请重试或手动填写模型 ID");
        } catch (ExecutionException failed) {
            if (failed.getCause() instanceof DiscoveryException safe) throw safe;
            throw failure("无法获取模型列表，请检查地址和密钥，或手动填写模型 ID");
        } finally {
            if (!task.isDone()) task.cancel(true);
        }
    }

    private List<String> fetch(ModelProviderStore.CatalogConnection config) {
        var models = new TreeSet<String>();
        var cursors = new HashSet<String>();
        String cursor = "";
        int[] remainingBytes = {MAX_RESPONSE_BYTES};
        for (int page = 0; page < 20; page++) {
            String path = config.protocol() == Protocol.OLLAMA ? "/api/tags" : "/models";
            if (config.protocol() == Protocol.ANTHROPIC) {
                path += "?limit=1000" + (cursor.isEmpty() ? "" : "&after_id="
                        + URLEncoder.encode(cursor, StandardCharsets.UTF_8));
            }
            JsonNode response = fetchPage(config, path, remainingBytes);
            var data = response.path(config.protocol() == Protocol.OLLAMA ? "models" : "data");
            if (!data.isArray()) throw failure("模型列表格式不受支持，请手动填写模型 ID");
            for (var entry : data) {
                var id = entry.path(config.protocol() == Protocol.OLLAMA ? "name" : "id");
                if (!id.isTextual() || id.asText().isBlank() || id.asText().length() > 200
                        || id.asText().chars().anyMatch(Character::isISOControl)) {
                    throw failure("模型列表包含无效的模型 ID，请手动填写");
                }
                models.add(id.asText());
                if (models.size() > 5000) throw failure("模型数量过多，请手动填写模型 ID");
            }
            if (config.protocol() != Protocol.ANTHROPIC || !response.path("has_more").asBoolean()) {
                return List.copyOf(models);
            }
            var lastId = response.path("last_id");
            if (!lastId.isTextual() || lastId.asText().isBlank() || data.isEmpty()
                    || !cursors.add(lastId.asText())) throw failure("模型列表分页无效，请手动填写模型 ID");
            cursor = lastId.asText();
        }
        throw failure("模型列表页数过多，请手动填写模型 ID");
    }

    private JsonNode fetchPage(ModelProviderStore.CatalogConnection config, String path, int[] remainingBytes) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) URI.create(config.baseUrl() + path).toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(config.timeoutMillis());
            connection.setReadTimeout(config.timeoutMillis());
            connection.setRequestProperty("Accept", "application/json");
            if (config.protocol() == Protocol.ANTHROPIC) {
                connection.setRequestProperty("anthropic-version", "2023-06-01");
                if (!config.apiKey().isEmpty()) connection.setRequestProperty("x-api-key", config.apiKey());
            } else if (!config.apiKey().isEmpty()) {
                connection.setRequestProperty("Authorization", "Bearer " + config.apiKey());
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw failure("模型列表接口返回 HTTP " + status + "，请检查地址、协议及密钥，或手动填写模型 ID");
            }
            byte[] bytes;
            try (var stream = connection.getInputStream()) { bytes = stream.readNBytes(remainingBytes[0] + 1); }
            remainingBytes[0] -= bytes.length;
            if (remainingBytes[0] < 0) throw failure("模型列表响应过大，请手动填写模型 ID");
            var response = json.readTree(bytes);
            if (response == null || !response.isObject()) throw failure("模型列表格式不受支持，请手动填写模型 ID");
            return response;
        } catch (IOException | IllegalArgumentException invalid) {
            throw failure("无法获取模型列表，请检查地址和密钥，或手动填写模型 ID");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static DiscoveryException failure(String message) { return new DiscoveryException(message); }

    /** Safe discovery failure without upstream bodies, endpoint details or credentials. */
    public static final class DiscoveryException extends RuntimeException {
        @java.io.Serial private static final long serialVersionUID = 1L;
        private DiscoveryException(String message) { super(message); }
    }
}
