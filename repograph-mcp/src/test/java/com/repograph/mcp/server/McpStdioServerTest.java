package com.repograph.mcp.server;

import com.repograph.mcp.client.RepographApiClient;
import com.repograph.mcp.tools.RepographMcpTools;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

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

    // ── tools/list — all tools registered ────────────────────────────────────

    @Test
    void tools_list_containsAllTools() {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> list =
                (List<Map<String, Object>>) realTools.list().get("tools");

        List<String> names = list.stream().map(t -> (String) t.get("name")).toList();
        assertTrue(names.contains("search_semantic"),  "Missing search_semantic");
        assertTrue(names.contains("search_keyword"),   "Missing search_keyword");
        assertTrue(names.contains("find_callers"),     "Missing find_callers");
        assertTrue(names.contains("get_impact"),       "Missing get_impact");
        assertTrue(names.contains("lookup_symbol"),    "Missing lookup_symbol");
        assertTrue(names.contains("search_code"),      "Missing search_code");
        assertTrue(names.contains("find_callees"),     "Missing find_callees");
        assertTrue(names.contains("find_subtypes"),    "Missing find_subtypes");
        assertTrue(names.contains("locate_at"),        "Missing locate_at");
        assertTrue(names.contains("find_entrypoints"), "Missing find_entrypoints");
        assertTrue(names.contains("analyze_flow"),     "Missing analyze_flow");
        assertTrue(names.contains("search_graphrag"),  "Missing search_graphrag");
        assertTrue(names.contains("build_context_pack"), "Missing build_context_pack");
        assertTrue(names.contains("triage_finding"),   "Missing triage_finding");
        assertTrue(names.contains("record_triage_feedback"), "Missing record_triage_feedback");
        assertTrue(names.contains("list_triage_feedback"), "Missing list_triage_feedback");
        assertTrue(names.contains("list_projects"),    "Missing list_projects");
        assertTrue(names.contains("trace_taint"),      "Missing trace_taint");
        assertTrue(names.contains("list_vulns"),       "Missing list_vulns");
        assertTrue(names.contains("scan_vuln_code"),    "Missing scan_vuln_code");
        assertTrue(names.contains("get_health_report"), "Missing get_health_report");
        assertTrue(names.contains("trigger_index"),     "Missing trigger_index");
        assertTrue(names.contains("index_status"),      "Missing index_status");
        assertEquals(23, list.size(), "Should have exactly 23 tools");
    }

    // ── search_keyword ───────────────────────────────────────────────────────

    @Test
    void searchKeyword_returnsMatchedTerms() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        String keywordJson = """
                [{
                  "unit": {
                    "qualifiedName": "com.example.Command#exec()",
                    "kind": "METHOD",
                    "language": "java",
                    "filePath": "src/main/java/com/example/Command.java",
                    "startLine": 10,
                    "endLine": 20,
                    "signature": "void exec()"
                  },
                  "score": 0.7,
                  "matchedTerms": ["cwe-78", "exec"]
                }]""";
        when(mockClient.get(contains("/api/v1/search/keyword"))).thenReturn(
                Optional.of(mapper.readTree(keywordJson)));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":20,"method":"tools/call",\
                "params":{"name":"search_keyword","arguments":{"query":"CWE-78 exec"}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("Command#exec"), "Should contain qualifiedName");
        assertTrue(text.contains("matched: cwe-78, exec"), "Should contain matched terms");
    }

    // ── search_graphrag ───────────────────────────────────────────────────────

    @Test
    void searchGraphRag_returnsFormattedMarkdown() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        String graphRagJson = """
                {
                  "results": [{
                    "unit": {
                      "qualifiedName": "com.example.AuthService#login(String)",
                      "kind": "METHOD",
                      "language": "java",
                      "filePath": "src/main/java/com/example/AuthService.java",
                      "startLine": 20,
                      "endLine": 35,
                      "signature": "public boolean login(String username)",
                      "rawSource": "public boolean login(String username) { return true; }",
                      "annotations": ["@Transactional"],
                      "metadata": {"is_entry_point": "true"}
                    },
                    "vectorScore": 0.88,
                    "securityScore": 0.75,
                    "finalScore": 0.91,
                    "source": "VECTOR",
                    "relation": "SEED",
                    "securitySignals": ["entry_point", "auth_check"]
                  }],
                  "seedCount": 1,
                  "callGraphExpanded": 0,
                  "impactExpanded": 0,
                  "securityHighlightCount": 1
                }""";
        when(mockClient.get(contains("graphrag"))).thenReturn(
                Optional.of(mapper.readTree(graphRagJson)));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        String req = """
                {"jsonrpc":"2.0","id":10,"method":"tools/call",\
                "params":{"name":"search_graphrag","arguments":{"query":"authentication login"}}}""";

        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch(req));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("GraphRAG search"), "Should contain header");
        assertTrue(text.contains("AuthService#login"), "Should contain qualifiedName");
        assertTrue(text.contains("entry_point"), "Should contain security signals");
        assertTrue(text.contains("login(String username)"), "Should contain rawSource");
    }

    // ── build_context_pack ───────────────────────────────────────────────────

    @Test
    void buildContextPack_returnsCitationReadyMarkdown() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        String contextPackJson = """
                {
                  "query": "authentication login",
                  "taskType": "security",
                  "evidence": [{
                    "citationId": "C1",
                    "qualifiedName": "com.example.AuthService#login(String)",
                    "kind": "METHOD",
                    "language": "java",
                    "filePath": "src/main/java/com/example/AuthService.java",
                    "startLine": 20,
                    "endLine": 35,
                    "source": "VECTOR",
                    "relation": "SEED",
                    "finalScore": 0.91,
                    "excerpt": "public boolean login(String username) { return true; }",
                    "truncated": false,
                    "securitySignals": ["entry_point"]
                  }],
                  "omittedReasons": [],
                  "requestedBudgetChars": 12000,
                  "usedBudgetChars": 54,
                  "seedCount": 1,
                  "callGraphExpanded": 0,
                  "impactExpanded": 0
                }""";
        when(mockClient.get(contains("/api/v1/context/pack"))).thenReturn(
                Optional.of(mapper.readTree(contextPackJson)));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":19,"method":"tools/call",\
                "params":{"name":"build_context_pack","arguments":{"query":"authentication login","taskType":"security"}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("Context Pack"), "Should contain header");
        assertTrue(text.contains("[C1]"), "Should contain citation ID");
        assertTrue(text.contains("AuthService#login"), "Should contain qualifiedName");
        assertTrue(text.contains("entry_point"), "Should contain security signals");
    }

    // ── triage_finding ───────────────────────────────────────────────────────

    @Test
    void triageFinding_returnsTriageMarkdown() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        String triageJson = """
                [{
                  "fingerprint": "abc123",
                  "report": {
                    "finding": {
                      "tool": "semgrep",
                      "ruleId": "java.lang.security.audit.command-injection",
                      "cwe": "CWE-78",
                      "severity": "HIGH",
                      "message": "Detected command injection",
                      "filePath": "src/main/java/App.java",
                      "startLine": 42
                    },
                    "located": true,
                    "locatedQualifiedName": "com.example.App#run(String)",
                    "verdict": "TRUE_RISK",
                    "confidence": 0.75,
                    "reasons": ["报警定位到 [C1] com.example.App#run(String)"],
                    "missingInfo": ["外部工具未提供数据流 trace"],
                    "remediation": "Avoid shell command string concatenation.",
                    "developerSummary": "该报警大概率是真实风险"
                  },
                  "markdown": "## report"
                }]""";
        when(mockClient.postJson(contains("/api/v1/triage/report"), contains("\"results\""))).thenReturn(
                mapper.readTree(triageJson));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":21,"method":"tools/call",\
                "params":{"name":"triage_finding","arguments":{"format":"semgrep","json":"{\\\"results\\\":[]}"}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("SAST triage reports"), "Should contain header");
        assertTrue(text.contains("TRUE_RISK"), "Should contain verdict");
        assertTrue(text.contains("abc123"), "Should contain fingerprint");
        assertTrue(text.contains("CWE-78"), "Should contain CWE");
        assertTrue(text.contains("Markdown report"), "Should contain markdown details");
    }

    @Test
    void recordTriageFeedback_returnsRecordedFeedback() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        when(mockClient.postJson(eq("/api/v1/triage/feedback"), contains("\"FALSE_POSITIVE\""))).thenReturn(
                mapper.readTree("""
                        {"fingerprint":"abc123","projectId":"proj123","status":"FALSE_POSITIVE",
                         "reviewer":"sec-team","reason":"sanitized upstream",
                         "updatedAt":"2026-07-11T10:00:00Z"}"""));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":22,"method":"tools/call",\
                "params":{"name":"record_triage_feedback","arguments":{
                  "fingerprint":"abc123","projectId":"proj123","status":"FALSE_POSITIVE",
                  "reviewer":"sec-team","reason":"sanitized upstream"}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("Triage feedback recorded"), "Should confirm feedback write");
        assertTrue(text.contains("abc123"), "Should contain fingerprint");
        assertTrue(text.contains("FALSE_POSITIVE"), "Should contain feedback status");
        assertTrue(text.contains("sanitized upstream"), "Should contain reason");
    }

    @Test
    void listTriageFeedback_returnsFeedbackTable() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        when(mockClient.get(contains("/api/v1/triage/feedback"))).thenReturn(
                Optional.of(mapper.readTree("""
                        [{"fingerprint":"abc123","projectId":"proj123","status":"TRUE_POSITIVE",
                          "reviewer":"sec-team","reason":"source reaches sink",
                          "updatedAt":"2026-07-11T10:00:00Z"}]""")));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":23,"method":"tools/call",\
                "params":{"name":"list_triage_feedback","arguments":{"projectId":"proj123"}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("Triage feedback"), "Should contain header");
        assertTrue(text.contains("abc123"), "Should contain fingerprint");
        assertTrue(text.contains("TRUE_POSITIVE"), "Should contain feedback status");
        assertTrue(text.contains("source reaches sink"), "Should contain reason");
    }

    // ── list_projects ─────────────────────────────────────────────────────────

    @Test
    void listProjects_returnsMarkdownTable() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        when(mockClient.get("/api/v1/projects")).thenReturn(Optional.of(mapper.readTree("""
                [{"projectId":"abc123","projectRoot":"/src/myapp",
                  "nodeCount":500,"indexedAt":"2026-07-01T10:00:00Z"}]""")));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":11,"method":"tools/call",\
                "params":{"name":"list_projects","arguments":{}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("abc123"),  "Should contain projectId");
        assertTrue(text.contains("/src/myapp"), "Should contain projectRoot");
        assertTrue(text.contains("500"),     "Should contain nodeCount");
    }

    // ── trace_taint ───────────────────────────────────────────────────────────

    @Test
    void traceTaint_sinkReached_showsRedFlag() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        String taintJson = """
                {
                  "sourceMethod": "com.example.Ctrl#submit(String)",
                  "sourceParamIndex": 0,
                  "paths": [{
                    "hops": [
                      {"methodQn":"com.example.Ctrl#submit(String)",
                       "from":{"kind":"PARAM","index":0,"calleeHint":null},
                       "to":{"kind":"CALL_ARG","index":0,"calleeHint":"executeQuery"}}
                    ],
                    "reachesSink": true,
                    "sinkDescription": "SINK:executeQuery.arg[0]"
                  }],
                  "methodsAnalyzed": 2,
                  "truncated": false
                }""";
        when(mockClient.get(contains("taint"))).thenReturn(Optional.of(mapper.readTree(taintJson)));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":12,"method":"tools/call",
                "params":{"name":"trace_taint","arguments":{"source":"com.example.Ctrl#submit(String)"}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("SINK REACHED"),          "Should flag sink");
        assertTrue(text.contains("executeQuery"),          "Should show sink name");
        assertTrue(text.contains("Ctrl#submit(String)"),   "Should show source method");
    }

    // ── list_vulns ────────────────────────────────────────────────────────────

    @Test
    void listVulns_returnsFormattedFindings() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        String vulnsJson = """
                [{"id":"abc1","ruleId":"SQL_INJECTION","cwe":"CWE-89","severity":"HIGH",
                  "status":"SUSPECTED","qualifiedName":"com.example.Repo#find(String)",
                  "filePath":"src/Repo.java","startLine":42,
                  "title":"SQL Injection","detail":"param[0] → SINK:executeQuery.arg[0]",
                  "foundAt":"2026-07-01T00:00:00Z"}]""";
        when(mockClient.get(contains("vulns"))).thenReturn(Optional.of(mapper.readTree(vulnsJson)));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":13,"method":"tools/call",
                "params":{"name":"list_vulns","arguments":{"projectId":"abc123"}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("SQL Injection"),    "Should show title");
        assertTrue(text.contains("HIGH"),             "Should show severity");
        assertTrue(text.contains("CWE-89"),           "Should show CWE");
        assertTrue(text.contains("Repo#find"),        "Should show qualifiedName");
    }

    // ── scan_vuln_code ────────────────────────────────────────────────────────

    @Test
    void scanVulnCode_returnsScanSummary() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        when(mockClient.post(contains("scan/code"))).thenReturn(
                mapper.readTree("""
                        {"projectId":"abc123","scannedUnits":120,"newFindings":3}"""));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":14,"method":"tools/call",
                "params":{"name":"scan_vuln_code","arguments":{"projectId":"abc123"}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("120"),          "Should show scannedUnits");
        assertTrue(text.contains("3"),            "Should show newFindings");
        assertTrue(text.contains("list_vulns"),   "Should suggest next step");
    }

    // ── get_health_report ─────────────────────────────────────────────────────

    @Test
    void getHealthReport_returnsScoreAndTopMethods() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        String reportJson = """
                {"projectId":"abc123","projectRoot":"/src","generatedAt":"2026-07-02T00:00:00Z",
                 "healthScore":42,"totalUnits":500,"totalFiles":80,"totalEdges":1200,
                 "vulnCritical":0,"vulnHigh":5,"vulnMedium":2,"vulnLow":0,
                 "packageCycles":1,"highComplexityMethods":8,"highInstabilityClasses":12,
                 "deadCodeCount":30,"testGapCount":100,"totalProductionMethods":300,
                 "topComplexMethods":[
                   {"qualifiedName":"com.example.Foo#bar(String)","filePath":"Foo.java",
                    "startLine":10,"kind":"METHOD","complexity":25}
                 ],
                 "topInstableCouplings":[
                   {"classQualifiedName":"com.example.Svc","fanIn":0,"fanOut":3,"instability":1.0}
                 ],
                 "packageCycleList":[]}""";
        when(mockClient.get(contains("metrics/report"))).thenReturn(
                Optional.of(mapper.readTree(reportJson)));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":15,"method":"tools/call",
                "params":{"name":"get_health_report","arguments":{"projectId":"abc123"}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("42 / 100"),            "Should show health score");
        assertTrue(text.contains("HIGH: 5"),             "Should show vuln count");
        assertTrue(text.contains("Foo#bar(String)"),     "Should show top complex method");
        assertTrue(text.contains("CC=25"),               "Should show complexity score");
        assertTrue(text.contains("analyze_flow"),        "Should suggest next tool");
    }

    // ── trigger_index ─────────────────────────────────────────────────────────

    @Test
    void triggerIndex_returnsStartedMessage() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        when(mockClient.post(contains("index/project"))).thenReturn(
                mapper.readTree("""
                        {"status":"running","message":"Indexing started in background",
                         "pollUrl":"/api/v1/index/project/status?projectRoot=/src/myapp"}"""));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":16,"method":"tools/call",
                "params":{"name":"trigger_index","arguments":{"projectRoot":"/src/myapp"}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("Indexing started"), "Should confirm indexing started");
        assertTrue(text.contains("index_status"),     "Should suggest index_status");
        assertTrue(text.contains("/src/myapp"),       "Should show projectRoot");
    }

    // ── index_status ──────────────────────────────────────────────────────────

    @Test
    void indexStatus_done_showsCompletionSummary() throws Exception {
        RepographApiClient mockClient = mock(RepographApiClient.class);
        when(mockClient.get(contains("index/project/status"))).thenReturn(
                Optional.of(mapper.readTree("""
                        {"status":"done","indexedAt":"2026-07-02T10:00:00Z",
                         "totalFiles":120,"parsedFiles":120,"totalUnits":800,
                         "totalEdges":2000,"durationMs":45000,"errors":[]}""")));

        RepographMcpTools realTools = new RepographMcpTools(mockClient);
        McpStdioServer localServer = new McpStdioServer(mapper, realTools, mockClient);
        JsonNode resp = parse(localServer.dispatch("""
                {"jsonrpc":"2.0","id":17,"method":"tools/call",
                "params":{"name":"index_status","arguments":{"projectRoot":"/src/myapp"}}}"""));

        assertFalse(resp.path("result").path("isError").asBoolean());
        String text = resp.path("result").path("content").get(0).path("text").asText();
        assertTrue(text.contains("done"),          "Should show done status");
        assertTrue(text.contains("800"),           "Should show unit count");
        assertTrue(text.contains("45s"),           "Should show duration");
        assertTrue(text.contains("list_projects"), "Should suggest list_projects");
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
