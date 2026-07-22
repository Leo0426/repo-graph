package com.repograph.finding.github;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

/**
 * GitHub 集成 Spring 配置，激活 {@link GitHubProperties} 绑定并提供 HTTP 客户端 bean。
 *
 * @author leolu
 * @since 0.1.0
 */
@Configuration
@EnableConfigurationProperties(GitHubProperties.class)
public class GitHubConfiguration {

    /**
     * 创建用于 GitHub REST API 调用的 {@link RestTemplate}，超时时间由 {@link GitHubProperties} 控制。
     *
     * <p>应用内存在多个 {@link RestTemplate} bean（Ollama 也注册了一个），注入方需用
     * {@link Qualifier}{@code ("githubRestTemplate")} 指明消费哪一个。
     *
     * @param properties GitHub 集成配置，不为 {@code null}
     * @param builder    Spring 提供的 RestTemplate 构建器，不为 {@code null}
     * @return 配置了读取和连接超时的 RestTemplate 实例
     */
    @Bean
    public RestTemplate githubRestTemplate(GitHubProperties properties, RestTemplateBuilder builder) {
        int seconds = properties.timeoutSeconds() > 0 ? properties.timeoutSeconds() : 15;
        Duration timeout = Duration.ofSeconds(seconds);
        return builder
                .connectTimeout(timeout)
                .readTimeout(timeout)
                .build();
    }
}
