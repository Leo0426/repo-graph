package com.repograph.mcp.server;

import com.repograph.mcp.client.RepographApiClient;
import com.repograph.mcp.tools.RepographMcpTools;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * MCP stdio 服务端主循环。
 *
 * <p>从 {@code System.in} 按行读取 JSON-RPC 2.0 请求，分发到对应处理方法，
 * 将响应写入 {@code System.out}。Spring 日志已配置到文件，stdout 保持纯净。
 *
 * <p>支持的 MCP 方法：
 * <ul>
 *   <li>{@code initialize} — 协议握手</li>
 *   <li>{@code notifications/initialized} — 客户端初始化完成通知（无响应）</li>
 *   <li>{@code tools/list} — 列举可用工具</li>
 *   <li>{@code tools/call} — 执行工具调用</li>
 * </ul>
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class McpStdioServer {

    private static final Logger log = LoggerFactory.getLogger(McpStdioServer.class);
    private static final String PROTOCOL_VERSION = "2024-11-05";

    private final ObjectMapper mapper;
    private final RepographMcpTools tools;
    private final RepographApiClient client;

    /**
     * @param mapper  Jackson ObjectMapper
     * @param tools   MCP 工具集
     * @param client  repograph-app HTTP 客户端
     */
    public McpStdioServer(ObjectMapper mapper, RepographMcpTools tools, RepographApiClient client) {
        this.mapper = mapper;
        this.tools  = tools;
        this.client = client;
    }

    /**
     * 启动 stdio 服务端主循环，阻塞直到 stdin 关闭（MCP 客户端断开）。
     *
     * @param baseUrl repograph-app 基础 URL
     * @throws IOException stdin/stdout I/O 错误
     */
    public void serve(String baseUrl) throws IOException {
        client.setBaseUrl(baseUrl);
        log.info("RepoGraph MCP server ready (target: {})", baseUrl);

        var reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        var writer = new PrintWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8), true);

        String line;
        while ((line = reader.readLine()) != null) {
            line = line.strip();
            if (line.isEmpty()) continue;
            log.debug("→ recv: {}", line);
            try {
                String response = dispatch(line);
                if (response != null) {
                    log.debug("← send: {}", response);
                    writer.println(response);
                }
            } catch (Exception e) {
                log.error("Dispatch error", e);
                Object id = extractId(line);
                writer.println(buildError(id, -32603, "Internal error: " + e.getMessage()));
            }
        }
        log.info("RepoGraph MCP server stopped (stdin closed)");
    }

    /**
     * 解析并分发单条 JSON-RPC 消息，返回序列化后的响应字符串。
     * 对 notification（无 id 字段）返回 {@code null}。
     *
     * <p>包级可见，供测试直接调用。
     *
     * @param json 原始 JSON-RPC 字符串
     * @return 响应 JSON 字符串，notification 时为 {@code null}
     */
    String dispatch(String json) throws JsonProcessingException {
        JsonNode node = mapper.readTree(json);
        String method = node.path("method").asText("");
        JsonNode idNode = node.path("id");

        // 通知消息没有 id — 处理但不响应
        if (idNode.isMissingNode() || idNode.isNull()) {
            log.debug("Notification: {}", method);
            return null;
        }

        Object id = idNode.isNumber() ? idNode.longValue() : idNode.asText();
        JsonNode params = node.path("params");

        try {
            Object result = switch (method) {
                case "initialize" -> handleInitialize();
                case "tools/list" -> tools.list();
                case "tools/call" -> tools.call(params);
                default -> throw new UnsupportedOperationException("Method not found: " + method);
            };
            return buildSuccess(id, result);
        } catch (UnsupportedOperationException e) {
            return buildError(id, -32601, e.getMessage());
        }
    }

    // ── 协议处理 ──────────────────────────────────────────────────────────────

    private Map<String, Object> handleInitialize() {
        return Map.of(
                "protocolVersion", PROTOCOL_VERSION,
                "capabilities", Map.of("tools", Map.of()),
                "serverInfo", Map.of("name", "repograph-mcp", "version", "0.1.0")
        );
    }

    // ── 响应构建 ──────────────────────────────────────────────────────────────

    private String buildSuccess(Object id, Object result) throws JsonProcessingException {
        var resp = new LinkedHashMap<String, Object>();
        resp.put("jsonrpc", "2.0");
        resp.put("id", id);
        resp.put("result", result);
        return mapper.writeValueAsString(resp);
    }

    private String buildError(Object id, int code, String message) {
        try {
            var resp = new LinkedHashMap<String, Object>();
            resp.put("jsonrpc", "2.0");
            resp.put("id", id);
            resp.put("error", Map.of("code", code, "message", message));
            return mapper.writeValueAsString(resp);
        } catch (JsonProcessingException e) {
            return "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32603,\"message\":\"Internal error\"}}";
        }
    }

    private Object extractId(String json) {
        try {
            JsonNode id = mapper.readTree(json).path("id");
            if (!id.isMissingNode() && !id.isNull()) {
                return id.isNumber() ? id.longValue() : id.asText();
            }
        } catch (Exception ignored) {}
        return null;
    }
}
