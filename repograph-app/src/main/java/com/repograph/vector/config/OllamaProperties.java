package com.repograph.vector.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Ollama Embedding 服务配置，绑定前缀 {@code repograph.ollama}。
 *
 * @param baseUrl        Ollama 服务基础 URL，默认 {@code http://localhost:11434}
 * @param model          使用的 Embedding 模型名称，默认 {@code nomic-embed-code}
 * @param timeoutSeconds HTTP 请求超时秒数，默认 {@code 30}
 * @author leolu
 * @since 0.1.0
 */
@ConfigurationProperties(prefix = "repograph.ollama")
public record OllamaProperties(
        String baseUrl,
        String model,
        int timeoutSeconds
) {}
