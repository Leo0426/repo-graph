package com.repograph.vector.embedding;

import com.repograph.core.vector.EmbeddingException;
import com.repograph.core.vector.EmbeddingService;
import com.repograph.vector.config.OllamaProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;

/**
 * 基于 Ollama HTTP API 的 Embedding 服务实现。
 *
 * <p>调用 {@code POST {baseUrl}/api/embed}，批量大小 32，超时时间由
 * {@link OllamaProperties#timeoutSeconds()} 控制。
 * 启动时执行 health check（{@code GET /api/tags}），服务未就绪时明确报错，不静默失败。
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class OllamaEmbeddingService implements EmbeddingService {

    private static final Logger log = LoggerFactory.getLogger(OllamaEmbeddingService.class);

    private static final int BATCH_SIZE = 32;

    private final OllamaProperties properties;
    private final RestTemplate restTemplate;

    /**
     * 通过构造器注入 Ollama 配置和 HTTP 客户端。
     *
     * @param properties   Ollama 服务配置，不为 {@code null}
     * @param restTemplate Spring RestTemplate 实例（{@code ollamaRestTemplate} bean），不为 {@code null}
     */
    public OllamaEmbeddingService(OllamaProperties properties,
                                   @Qualifier("ollamaRestTemplate") RestTemplate restTemplate) {
        this.properties = properties;
        this.restTemplate = restTemplate;
    }

    /**
     * 对文本列表进行批量 Embedding，返回与输入顺序对应的向量列表。
     *
     * <p>内部按批大小 32 分批请求 Ollama，所有批次完成后合并返回。
     *
     * @param texts 待嵌入的文本列表，不为 {@code null}；空列表直接返回空结果
     * @return 与 {@code texts} 顺序一致的 float 向量列表；每个向量维度由模型决定（默认 768）
     * @throws EmbeddingException Ollama 服务不可达或返回错误时抛出
     */
    @Override
    public List<float[]> embed(List<String> texts) {
        if (texts == null || texts.isEmpty()) {
            return List.of();
        }

        String embedUrl = properties.baseUrl() + "/api/embed";
        List<float[]> results = new ArrayList<>(texts.size());

        for (int i = 0; i < texts.size(); i += BATCH_SIZE) {
            List<String> batch = texts.subList(i, Math.min(i + BATCH_SIZE, texts.size()));
            try {
                EmbedRequest request = new EmbedRequest(properties.model(), batch);
                HttpHeaders headers = new HttpHeaders();
                headers.setContentType(MediaType.APPLICATION_JSON);
                HttpEntity<EmbedRequest> entity = new HttpEntity<>(request, headers);

                EmbedResponse response = restTemplate.postForObject(embedUrl, entity, EmbedResponse.class);
                if (response == null || response.embeddings() == null) {
                    throw new EmbeddingException("Ollama returned null response for batch at offset " + i);
                }
                for (double[] vec : response.embeddings()) {
                    float[] floats = new float[vec.length];
                    for (int j = 0; j < vec.length; j++) {
                        floats[j] = (float) vec[j];
                    }
                    results.add(floats);
                }
            } catch (RestClientException e) {
                throw new EmbeddingException(
                        "Failed to call Ollama at " + embedUrl + ": " + e.getMessage(), e);
            }
        }

        return results;
    }

    /**
     * 检测 Ollama 服务是否可用（调用 {@code GET /api/tags}）。
     *
     * @throws EmbeddingException 服务不可达时抛出，包含明确的地址和端口信息
     */
    public void healthCheck() {
        String tagsUrl = properties.baseUrl() + "/api/tags";
        try {
            restTemplate.getForObject(tagsUrl, String.class);
            log.info("Ollama health check passed: {}", tagsUrl);
        } catch (RestClientException e) {
            throw new EmbeddingException(
                    "Ollama service is not available at " + properties.baseUrl()
                    + ". Please ensure Ollama is running and model '"
                    + properties.model() + "' is loaded.", e);
        }
    }

    // ── DTO records ──────────────────────────────────────────────────────────

    private record EmbedRequest(
            @JsonProperty("model") String model,
            @JsonProperty("input") List<String> input
    ) {}

    private record EmbedResponse(
            @JsonProperty("embeddings") double[][] embeddings
    ) {}
}
