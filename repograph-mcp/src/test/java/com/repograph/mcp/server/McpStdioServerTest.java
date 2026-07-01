package com.repograph.mcp.server;

import com.repograph.mcp.client.RepographApiClient;
import com.repograph.mcp.tools.RepographMcpTools;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * McpStdioServer 单元测试：验证 JSON-RPC 2.0 协议分发和响应格式。
 *
 * @author leolu
 * @since 0.1.0
 */
class McpStdioServerTest {

    private McpStdioServer server;
    private RepographMcpTools tools;
    private ObjectMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new ObjectMapper();
        tools = mock(RepographMcpTools.class);
        RepographApiClient client = mock(RepographApiClient.class);
        server = new McpStdioServer(mapper, tools, client);
    }

    // ── initialize ────────────────────────────────────────────────────────────

    @Test
    void dispatch_initialize_returnsProtocolVersion() throws Exception {
        String req = """
                {"jsonrpc":"2.0","id":1,"method":"initialize",\
                "params":{"protocolVersion":"2024-11-05","capabilities":{}}}""";

        JsonNode resp = parse(server.dispatch(req));

        assertEquals("2.0", resp.path("jsonrpc").asText());
        assertEquals(1, resp.path("id").asLong());
        assertEquals("2024-11-05", resp.path("result").path("protocolVersion").asText());
        assertEquals("repograph-mcp", resp.path("result").path("serverInfo").path("name").asText());
        assertEquals("0.1.0",   resp.path("result").path("serverInfo").path("version").asText());
        assertFalse(resp.has("error"));
    }

    @Test
    void dispatch_initialize_idPreserved_string() throws Exception {
        String req = """
                {"jsonrpc":"2.0","id":"abc-123","method":"initialize","params":{}}""";

        JsonNode resp = parse(server.dispatch(req));
        assertEquals("abc-123", resp.path("id").asText());
    }

    // ── tools/list ────────────────────────────────────────────────────────────

    @Test
    void dispatch_toolsList_returnsToolsFromRegistry() throws Exception {
        when(tools.list()).thenReturn(Map.of("tools", List.of(
                Map.of("name", "search_semantic", "description", "test", "inputSchema", Map.of())
        )));

        String req = """
                {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}""";

        JsonNode resp = parse(server.dispatch(req));

        assertEquals(2, resp.path("id").asLong());
        assertTrue(resp.path("result").path("tools").isArray());
        assertEquals("search_semantic",
                resp.path("result").path("tools").get(0).path("name").asText());
    }

    // ── tools/call ────────────────────────────────────────────────────────────

    @Test
    void dispatch_toolsCall_delegatesToTools() throws Exception {
        Map<String, Object> toolResult = Map.of(
                "content", List.of(Map.of("type", "text", "text", "Found 2 results")),
                "isError", false
        );
        when(tools.call(any())).thenReturn(toolResult);

        String req = """
                {"jsonrpc":"2.0","id":3,"method":"tools/call",\
                "params":{"name":"search_semantic","arguments":{"query":"HTTP handler"}}}""";

        JsonNode resp = parse(server.dispatch(req));

        assertEquals(3, resp.path("id").asLong());
        assertFalse(resp.path("result").path("isError").asBoolean());
        assertEquals("Found 2 results",
                resp.path("result").path("content").get(0).path("text").asText());
        verify(tools).call(any(JsonNode.class));
    }

    // ── notifications ─────────────────────────────────────────────────────────

    @Test
    void dispatch_initializedNotification_returnsNull() throws Exception {
        String req = """
                {"jsonrpc":"2.0","method":"notifications/initialized"}""";

        assertNull(server.dispatch(req), "Notifications must not generate a response");
    }

    @Test
    void dispatch_notificationWithNullId_returnsNull() throws Exception {
        String req = """
                {"jsonrpc":"2.0","id":null,"method":"notifications/initialized"}""";

        assertNull(server.dispatch(req));
    }

    // ── unknown method ────────────────────────────────────────────────────────

    @Test
    void dispatch_unknownMethod_returnsMethodNotFoundError() throws Exception {
        String req = """
                {"jsonrpc":"2.0","id":9,"method":"unknown/method","params":{}}""";

        JsonNode resp = parse(server.dispatch(req));

        assertEquals(9, resp.path("id").asLong());
        assertEquals(-32601, resp.path("error").path("code").asInt());
        assertTrue(resp.path("error").path("message").asText().contains("Method not found"));
        assertFalse(resp.has("result"));
    }

    // ── tools/list — all 8 tools registered ──────────────────────────────────

    @Test
    void tools_list_containsAllTools() {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> list =
                (List<Map<String, Object>>) realTools.list().get("tools");

        List<String> names = list.stream().map(t -> (String) t.get("name")).toList();
        assertTrue(names.contains("search_semantic"),  "Missing search_semantic");
        assertTrue(names.contains("find_callers"),     "Missing find_callers");
        assertTrue(names.contains("get_impact"),       "Missing get_impact");
        assertTrue(names.contains("lookup_symbol"),    "Missing lookup_symbol");
        assertTrue(names.contains("search_code"),      "Missing search_code");
        assertTrue(names.contains("find_callees"),     "Missing find_callees");
        assertTrue(names.contains("find_subtypes"),    "Missing find_subtypes");
        assertTrue(names.contains("locate_at"),        "Missing locate_at");
        assertTrue(names.contains("find_entrypoints"), "Missing find_entrypoints");
        assertTrue(names.contains("analyze_flow"),     "Missing analyze_flow");
        assertEquals(10, list.size(), "Should have exactly 10 tools");
    }

    // ── malformed JSON ────────────────────────────────────────────────────────

    @Test
    void dispatch_malformedJson_throwsJsonProcessingException() {
        assertThrows(Exception.class, () -> server.dispatch("{not valid json"));
    }

    // ── helper ───────────────────────────────────────────────────────────────

    private JsonNode parse(String json) throws Exception {
        assertNotNull(json, "Response should not be null");
        return mapper.readTree(json);
    }
}
