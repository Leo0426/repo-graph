package com.repograph.vector.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

/**
 * 向量模块 Spring 配置，激活 Qdrant 和 Ollama 属性绑定，并提供 HTTP 客户端 bean。
 *
 * @author leolu
 * @since 0.1.0
 */
@Configuration
@EnableConfigurationProperties({QdrantProperties.class, OllamaProperties.class})
public class VectorConfiguration {

    /**
     * 创建用于 Ollama HTTP 调用的 {@link RestTemplate}，超时时间由 {@link OllamaProperties} 控制。
     *
     * @param ollamaProperties Ollama 服务配置，不为 {@code null}
     * @param builder          Spring 提供的 RestTemplate 构建器，不为 {@code null}
     * @return 配置了读取和连接超时的 RestTemplate 实例
     */
    @Bean
    public RestTemplate ollamaRestTemplate(OllamaProperties ollamaProperties,
                                            RestTemplateBuilder builder) {
        Duration timeout = Duration.ofSeconds(ollamaProperties.timeoutSeconds());
        return builder
                .connectTimeout(timeout)
                .readTimeout(timeout)
                .build();
    }
}
