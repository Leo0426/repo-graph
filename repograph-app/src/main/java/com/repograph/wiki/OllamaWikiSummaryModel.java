package com.repograph.wiki;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.repograph.core.advisory.LlmAdvisorySettings;
import com.repograph.core.advisory.LlmAdvisorySettingsService;
import com.repograph.core.wiki.WikiModelException;
import com.repograph.core.wiki.WikiSummaryModel;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * Ollama {@code /api/chat} 的分层摘要模型适配器（S2）。
 *
 * <p>复用 advisory 的运行时设置（页面开关/BaseURL/模型）与有界 HTTP 客户端；
 * 输出为自由文本（由调用方做 JSON 解析与 citation 校验）。通道关闭时
 * {@link #available()} 返回 {@code false}，上层只产出确定性结构卡。
 *
 * @author leolu
 * @since 0.7.0
 */
@Component
public class OllamaWikiSummaryModel implements WikiSummaryModel {

    private final LlmAdvisorySettingsService settingsService;
    private final RestTemplate restTemplate;

    public OllamaWikiSummaryModel(
            LlmAdvisorySettingsService settingsService,
            @Qualifier("llmAdvisoryRestTemplate") RestTemplate restTemplate) {
        this.settingsService = settingsService;
        this.restTemplate = restTemplate;
    }

    @Override
    public boolean available() {
        LlmAdvisorySettings settings = settingsService.current();
        return settings.enabled()
                && "OLLAMA".equals(settings.provider())
                && !settings.baseUrl().isBlank()
                && !settings.model().isBlank();
    }

    @Override
    public String model() {
        LlmAdvisorySettings settings = settingsService.current();
        return settings.enabled() ? settings.model() : "";
    }

    @Override
    public String complete(String systemPrompt, String userPrompt) {
        LlmAdvisorySettings settings = settingsService.current();
        if (!settings.enabled()) {
            throw new WikiModelException("Ollama wiki summary is disabled");
        }
        ChatRequest request = new ChatRequest(
                settings.model(),
                List.of(
                        new Message("system", systemPrompt),
                        new Message("user", userPrompt)),
                false,
                Map.of("temperature", 0));
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            ChatResponse response = restTemplate.postForObject(
                    settings.baseUrl() + "/api/chat",
                    new HttpEntity<>(request, headers),
                    ChatResponse.class);
            if (response == null || response.message() == null
                    || response.message().content() == null
                    || response.message().content().isBlank()) {
                throw new WikiModelException("Ollama returned an empty wiki summary response");
            }
            return response.message().content();
        } catch (RestClientResponseException e) {
            throw new WikiModelException(
                    "Ollama rejected the wiki summary request (HTTP "
                            + e.getStatusCode().value() + ")", e);
        } catch (RestClientException e) {
            throw new WikiModelException("Ollama wiki summary endpoint is unavailable", e);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Message(String role, String content) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ChatRequest(
            String model,
            List<Message> messages,
            boolean stream,
            Map<String, Integer> options) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ChatResponse(Message message) {
    }
}
