package com.repograph.finding.github;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * GitHub PR 评论集成配置，绑定前缀 {@code repograph.github}。
 *
 * @param token         Personal Access Token 或 GitHub App token；为空时发评论会抛
 *                      {@link GitHubCommentException}
 * @param apiBaseUrl    GitHub REST API 基础 URL，默认 {@code https://api.github.com}
 * @param timeoutSeconds HTTP 请求超时秒数，默认 {@code 15}
 * @author leolu
 * @since 0.1.0
 */
@ConfigurationProperties(prefix = "repograph.github")
public record GitHubProperties(
        String token,
        String apiBaseUrl,
        int timeoutSeconds
) {}
