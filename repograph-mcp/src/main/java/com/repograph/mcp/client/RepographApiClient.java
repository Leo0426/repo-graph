package com.repograph.mcp.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;

/**
 * 轻量级 HTTP 客户端，调用运行中的 repograph-app REST API。
 *
 * <p>使用 Java 标准库 {@link HttpClient}，无额外依赖。
 * 404 响应返回 {@link Optional#empty()}；其他非 2xx 响应抛出异常。
 *
 * @author leolu
 * @since 0.1.0
 */
@Component
public class RepographApiClient {

    private static final Logger log = LoggerFactory.getLogger(RepographApiClient.class);

    private final ObjectMapper mapper;
    private final HttpClient http;
    private volatile String baseUrl;

    /**
     * @param mapper          Jackson ObjectMapper
     * @param timeoutSeconds  HTTP 请求超时秒数（来自配置）
     */
    public RepographApiClient(ObjectMapper mapper,
                        @Value("${repograph.timeout-seconds:30}") int timeoutSeconds) {
        this.mapper = mapper;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    /**
     * 设置 repograph-app 基础 URL（由 CLI 命令在启动时调用）。
     *
     * @param baseUrl 如 {@code http://localhost:8080}
     */
    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        log.info("RepoGraph API target: {}", this.baseUrl);
    }

    /**
     * 执行 GET 请求并将响应体解析为 {@link JsonNode}。
     *
     * @param path 相对路径（含查询参数），如 {@code /api/v1/search/semantic?q=foo}
     * @return 解析后的 JSON；404 时返回 {@link Optional#empty()}
     * @throws RepographApiException repograph-app 返回错误或连接失败
     */
    public Optional<JsonNode> get(String path) {
        if (baseUrl == null) throw new RepographApiException("RepoGraph base URL not configured");

        var uri = URI.create(baseUrl + path);
        var req = HttpRequest.newBuilder(uri)
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(30))
                .GET()
                .build();

        log.debug("GET {}", uri);
        try {
            var resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            log.debug("← {} ({})", resp.statusCode(), path);

            if (resp.statusCode() == 404) return Optional.empty();
            if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
                throw new RepographApiException("RepoGraph API error " + resp.statusCode() + ": " + resp.body());
            }
            return Optional.of(mapper.readTree(resp.body()));
        } catch (RepographApiException e) {
            throw e;
        } catch (java.net.ConnectException e) {
            throw new RepographApiException(
                    "Cannot connect to repograph-app at " + baseUrl + ". Is it running? Try: repograph serve", e);
        } catch (Exception e) {
            throw new RepographApiException("HTTP request failed: " + e.getMessage(), e);
        }
    }

    /** 运行时异常，包装 RepoGraph API 调用失败。 */
    @SuppressWarnings("serial")
    public static class RepographApiException extends RuntimeException {
        public RepographApiException(String msg) { super(msg); }
        public RepographApiException(String msg, Throwable cause) { super(msg, cause); }
    }
}
