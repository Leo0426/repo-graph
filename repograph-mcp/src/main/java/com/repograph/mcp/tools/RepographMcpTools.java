package com.repograph.mcp.tools;

import com.repograph.mcp.client.RepographApiClient;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * RepoGraph MCP 工具集，定义工具 JSON Schema 并将工具调用转发至 repograph-app REST API。
 *
 * <p>工具目录见 {@link McpToolCatalog}，工具输出的 Markdown 渲染见 {@link McpResultFormatter}。
 * 工具输出为 AI agent 可直接阅读的 Markdown 格式文本。
 *
 * @author leolu
 * @since 0.1.0
 */
@Component
public class RepographMcpTools {

    private static final Logger log = LoggerFactory.getLogger(RepographMcpTools.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final RepographApiClient client;

    /** @param client repograph-app HTTP 客户端 */
    public RepographMcpTools(RepographApiClient client) {
        this.client = client;
    }

    // ── 协议方法 ──────────────────────────────────────────────────────────────

    /**
     * 返回 tools/list 响应结构。
     *
     * @return {@code {"tools": [...]}} Map
     */
    public Map<String, Object> list() {
        return Map.of("tools", McpToolCatalog.TOOL_LIST);
    }

    /**
     * 分发 tools/call 请求到对应工具实现。
     *
     * @param params JSON-RPC params 节点（含 name、arguments）
     * @return MCP tool result：{@code {"content": [...], "isError": boolean}}
     */
    public Map<String, Object> call(JsonNode params) {
        String name = params.path("name").asText("");
        JsonNode args = params.path("arguments");
        log.info("Tool call: {} args={}", name, args);

        try {
            String text = switch (name) {
                case "search_semantic" -> runSearchSemantic(args);
                case "search_keyword"  -> runSearchKeyword(args);
                case "find_callers"    -> runFindCallers(args);
                case "get_impact"      -> runGetImpact(args);
                case "lookup_symbol"   -> runLookupSymbol(args);
                case "search_code"     -> runSearchCode(args);
                case "find_callees"    -> runFindCallees(args);
                case "find_subtypes"   -> runFindSubtypes(args);
                case "locate_at"       -> runLocateAt(args);
                case "find_entrypoints" -> runFindEntrypoints(args);
                case "analyze_flow"      -> runAnalyzeFlow(args);
                case "search_graphrag"   -> runSearchGraphRag(args);
                case "build_context_pack" -> runBuildContextPack(args);
                case "triage_finding"    -> runTriageFinding(args);
                case "record_triage_feedback" -> runRecordTriageFeedback(args);
                case "list_triage_feedback"   -> runListTriageFeedback(args);
                case "list_projects"     -> runListProjects();
                case "trace_taint"       -> runTraceTaint(args);
                case "list_vulns"        -> runListVulns(args);
                case "scan_vuln_code"    -> runScanVulnCode(args);
                case "get_health_report" -> runGetHealthReport(args);
                case "trigger_index"     -> runTriggerIndex(args);
                case "index_status"      -> runIndexStatus(args);
                default -> "Unknown tool: " + name;
            };
            return toolResult(text, false);
        } catch (RepographApiClient.RepographApiException e) {
            log.warn("Tool '{}' API error: {}", name, e.getMessage());
            return toolResult(e.getMessage(), true);
        } catch (Exception e) {
            log.error("Tool '{}' unexpected error", name, e);
            return toolResult("Unexpected error: " + e.getMessage(), true);
        }
    }

    // ── 工具实现 ──────────────────────────────────────────────────────────────

    private String runSearchSemantic(JsonNode args) {
        String query = require(args, "query");
        var path = new StringBuilder("/api/v1/search/semantic?q=").append(enc(query));
        opt(args, "lang").ifPresent(v -> path.append("&lang=").append(enc(v)));
        opt(args, "kind").ifPresent(v -> path.append("&kind=").append(enc(v)));
        path.append("&limit=").append(args.path("limit").asInt(10));

        Optional<JsonNode> result = client.get(path.toString());
        return McpResultFormatter.formatSearchResults("\"" + query + "\"", result.orElse(null));
    }

    private String runSearchKeyword(JsonNode args) {
        String query = require(args, "query");
        var path = new StringBuilder("/api/v1/search/keyword?q=").append(enc(query));
        opt(args, "lang").ifPresent(v -> path.append("&lang=").append(enc(v)));
        opt(args, "kind").ifPresent(v -> path.append("&kind=").append(enc(v)));
        opt(args, "projectId").ifPresent(v -> path.append("&projectId=").append(enc(v)));
        path.append("&limit=").append(args.path("limit").asInt(10));

        Optional<JsonNode> result = client.get(path.toString());
        return McpResultFormatter.formatSearchResults("\"" + query + "\"", result.orElse(null));
    }

    private String runSearchCode(JsonNode args) {
        String snippet = require(args, "snippet");
        var path = new StringBuilder("/api/v1/search/code?snippet=").append(enc(snippet));
        opt(args, "lang").ifPresent(v -> path.append("&lang=").append(enc(v)));
        path.append("&limit=").append(args.path("limit").asInt(10));

        Optional<JsonNode> result = client.get(path.toString());
        String label = snippet.lines().findFirst().map(l -> "\"" + l.strip() + "\"").orElse("snippet");
        return McpResultFormatter.formatSearchResults(label, result.orElse(null));
    }

    private String runFindCallers(JsonNode args) {
        String target = require(args, "target");
        int depth = args.path("depth").asInt(1);
        Optional<JsonNode> result = client.get(
                "/api/v1/graph/callers?target=" + enc(target) + "&depth=" + depth);
        return McpResultFormatter.formatUnitList(
                "Callers of `" + target + "` (depth=" + depth + ")",
                result.orElse(null),
                "No callers found. The symbol may not exist or has no known callers in the indexed code."
        );
    }

    private String runGetImpact(JsonNode args) {
        String target = require(args, "target");
        Optional<JsonNode> result = client.get("/api/v1/graph/impact?target=" + enc(target));
        return McpResultFormatter.formatUnitList(
                "Impact analysis for `" + target + "`",
                result.orElse(null),
                "No impacted code found. The symbol may not exist or nothing depends on it."
        );
    }

    private String runFindCallees(JsonNode args) {
        String target = require(args, "target");
        int depth = args.path("depth").asInt(1);
        Optional<JsonNode> result = client.get(
                "/api/v1/graph/callees?target=" + enc(target) + "&depth=" + depth);
        return McpResultFormatter.formatUnitList(
                "Callees of `" + target + "` (depth=" + depth + ")",
                result.orElse(null),
                "No callees found. The symbol may not exist or makes no tracked calls."
        );
    }

    private String runFindSubtypes(JsonNode args) {
        String target = require(args, "target");
        Optional<JsonNode> result = client.get("/api/v1/graph/subtypes?target=" + enc(target));
        return McpResultFormatter.formatUnitList(
                "Subtypes of `" + target + "`",
                result.orElse(null),
                "No subtypes found. The type may not exist in the index, or nothing extends/implements it."
        );
    }

    private String runFindEntrypoints(JsonNode args) {
        String projectId = args.path("projectId").asText("");
        String lang = args.path("lang").asText("");
        StringBuilder url = new StringBuilder("/api/v1/graph/entrypoints");
        boolean first = true;
        if (!projectId.isEmpty()) {
            url.append(first ? "?" : "&").append("projectId=").append(enc(projectId));
            first = false;
        }
        if (!lang.isEmpty()) {
            url.append(first ? "?" : "&").append("lang=").append(enc(lang));
        }
        Optional<JsonNode> result = client.get(url.toString());
        String scope = projectId.isEmpty() ? "(all projects)" : "(project " + projectId + ")";
        if (!lang.isEmpty()) scope += " lang=" + lang;
        return McpResultFormatter.formatUnitList(
                "Entry points " + scope,
                result.orElse(null),
                "No entry points found. Run an index first, or check the projectId."
        );
    }

    private String runLocateAt(JsonNode args) {
        String file = require(args, "file");
        int line = args.path("line").asInt(1);
        Optional<JsonNode> result = client.get(
                "/api/v1/locate?file=" + enc(file) + "&line=" + line);
        if (result.isEmpty()) {
            return "No symbol found at `" + file + "` line " + line + ".\n\n" +
                   "The file may not have been indexed, or the line is inside a comment or blank area.";
        }
        return "**Symbol at** `" + file + "` **line " + line + ":**\n\n" + McpResultFormatter.formatUnit(result.get());
    }

    private String runGetHealthReport(JsonNode args) {
        String projectId = require(args, "projectId");
        Optional<JsonNode> result = client.get("/api/v1/metrics/report?projectId=" + enc(projectId));
        if (result.isEmpty()) {
            return "No health report for project `" + projectId + "`.\n\n" +
                   "Ensure the project is indexed — use `list_projects` to verify.";
        }
        return McpResultFormatter.formatHealthReport(result.get());
    }

    private String runTriggerIndex(JsonNode args) {
        String projectRoot = require(args, "projectRoot");
        var path = new StringBuilder("/api/v1/index/project?projectRoot=").append(enc(projectRoot));
        opt(args, "lang").ifPresent(v -> path.append("&lang=").append(enc(v)));
        opt(args, "strategy").ifPresent(v -> path.append("&strategy=").append(enc(v)));

        try {
            JsonNode result = client.post(path.toString());
            return "## Indexing started\n\n" +
                   "**Project root:** `" + projectRoot + "`\n" +
                   "**Status:** " + result.path("status").asText() + "\n\n" +
                   result.path("message").asText("Indexing started in background") + "\n\n" +
                   "Call `index_status` with `projectRoot=" + projectRoot + "` to monitor progress.\n" +
                   "Large codebases may take several minutes (embedding generation is the bottleneck).";
        } catch (RepographApiClient.RepographApiException e) {
            if (e.getMessage() != null && e.getMessage().contains("409")) {
                return "**Indexing already in progress** for `" + projectRoot + "`.\n\n" +
                       "Call `index_status` with `projectRoot=" + projectRoot +
                       "` to monitor progress.";
            }
            throw e;
        }
    }

    private String runIndexStatus(JsonNode args) {
        String projectRoot = require(args, "projectRoot");
        Optional<JsonNode> result = client.get(
                "/api/v1/index/project/status?projectRoot=" + enc(projectRoot));
        if (result.isEmpty()) {
            return "No indexing record found for `" + projectRoot + "`.\n\n" +
                   "Call `trigger_index` with `projectRoot=" + projectRoot + "` to start indexing.";
        }
        return McpResultFormatter.formatIndexStatus(projectRoot, result.get());
    }

    private String runSearchGraphRag(JsonNode args) {
        String query = require(args, "query");
        var path = new StringBuilder("/api/v1/search/graphrag?q=").append(enc(query));
        opt(args, "lang").ifPresent(v -> path.append("&lang=").append(enc(v)));
        opt(args, "projectId").ifPresent(v -> path.append("&projectId=").append(enc(v)));
        path.append("&limit=").append(args.path("limit").asInt(10));
        path.append("&depth=").append(args.path("depth").asInt(1));
        if (!args.path("callGraph").isMissingNode()) {
            path.append("&callGraph=").append(args.path("callGraph").asBoolean(true));
        }
        if (!args.path("impactExpansion").isMissingNode()) {
            path.append("&impactExpansion=").append(args.path("impactExpansion").asBoolean(true));
        }

        Optional<JsonNode> result = client.get(path.toString());
        if (result.isEmpty()) {
            return "No GraphRAG results for \"" + query + "\".\n\n" +
                   "Ensure the project is indexed and repograph-app is running.";
        }
        return McpResultFormatter.formatGraphRagResult(query, result.get());
    }

    private String runBuildContextPack(JsonNode args) {
        String query = require(args, "query");
        var path = new StringBuilder("/api/v1/context/pack?q=").append(enc(query));
        opt(args, "taskType").ifPresent(v -> path.append("&taskType=").append(enc(v)));
        if (!args.path("budgetChars").isMissingNode()) {
            path.append("&budgetChars=").append(args.path("budgetChars").asInt(12000));
        }
        opt(args, "lang").ifPresent(v -> path.append("&lang=").append(enc(v)));
        opt(args, "projectId").ifPresent(v -> path.append("&projectId=").append(enc(v)));
        path.append("&limit=").append(args.path("limit").asInt(10));
        path.append("&depth=").append(args.path("depth").asInt(1));
        if (!args.path("callGraph").isMissingNode()) {
            path.append("&callGraph=").append(args.path("callGraph").asBoolean(true));
        }
        if (!args.path("impactExpansion").isMissingNode()) {
            path.append("&impactExpansion=").append(args.path("impactExpansion").asBoolean(true));
        }

        Optional<JsonNode> result = client.get(path.toString());
        if (result.isEmpty()) {
            return "No context pack for \"" + query + "\".\n\n" +
                   "Ensure the project is indexed and repograph-app is running.";
        }
        return McpResultFormatter.formatContextPack(result.get());
    }

    private String runTriageFinding(JsonNode args) {
        String format = require(args, "format");
        String json = require(args, "json");
        var path = new StringBuilder("/api/v1/triage/report?format=").append(enc(format));
        opt(args, "projectId").ifPresent(v -> path.append("&projectId=").append(enc(v)));
        if (!args.path("budgetChars").isMissingNode()) {
            path.append("&budgetChars=").append(args.path("budgetChars").asInt(12000));
        }
        if (!args.path("maxFindings").isMissingNode()) {
            path.append("&maxFindings=").append(args.path("maxFindings").asInt(10));
        }

        JsonNode result = client.postJson(path.toString(), json);
        return McpResultFormatter.formatTriageReports(format, result);
    }

    private String runRecordTriageFeedback(JsonNode args) throws Exception {
        String fingerprint = require(args, "fingerprint");
        String projectId = require(args, "projectId");
        String status = require(args, "status");

        ObjectNode body = JSON.createObjectNode();
        body.put("fingerprint", fingerprint);
        body.put("projectId", projectId);
        body.put("status", status);
        opt(args, "reviewer").ifPresent(v -> body.put("reviewer", v));
        opt(args, "reason").ifPresent(v -> body.put("reason", v));

        JsonNode result = client.postJson("/api/v1/triage/feedback", JSON.writeValueAsString(body));
        return "## Triage feedback recorded\n\n" + McpResultFormatter.formatTriageFeedback(result);
    }

    private String runListTriageFeedback(JsonNode args) {
        String projectId = require(args, "projectId");
        var path = new StringBuilder("/api/v1/triage/feedback?projectId=").append(enc(projectId));
        opt(args, "status").ifPresent(v -> path.append("&status=").append(enc(v)));

        Optional<JsonNode> result = client.get(path.toString());
        if (result.isEmpty() || !result.get().isArray() || result.get().isEmpty()) {
            return "No triage feedback for project `" + projectId + "`.\n\n" +
                   "Use `record_triage_feedback` after reviewing reports from `triage_finding`.";
        }
        return McpResultFormatter.formatTriageFeedbackList(projectId, result.get());
    }

    private String runListProjects() {
        Optional<JsonNode> result = client.get("/api/v1/projects");
        if (result.isEmpty() || !result.get().isArray() || result.get().isEmpty()) {
            return "No projects indexed yet.\n\n" +
                   "Run `POST /api/v1/index/project` or use `trigger_index` to index a codebase.";
        }
        JsonNode projects = result.get();
        var sb = new StringBuilder();
        sb.append("## Indexed projects (").append(projects.size()).append(")\n\n");
        sb.append("| projectId | root | nodes | indexed at |\n");
        sb.append("|-----------|------|-------|------------|\n");
        for (JsonNode p : projects) {
            sb.append("| `").append(p.path("projectId").asText()).append("`")
              .append(" | `").append(p.path("projectRoot").asText()).append("`")
              .append(" | ").append(p.path("nodeCount").asInt())
              .append(" | ").append(p.path("indexedAt").asText()).append(" |\n");
        }
        return sb.toString().stripTrailing();
    }

    private String runTraceTaint(JsonNode args) {
        String source = require(args, "source");
        int paramIndex = args.path("paramIndex").asInt(0);
        int maxDepth   = args.path("maxDepth").asInt(6);
        var path = new StringBuilder("/api/v1/flow/taint")
                .append("?source=").append(enc(source))
                .append("&paramIndex=").append(paramIndex)
                .append("&maxDepth=").append(maxDepth);
        opt(args, "projectId").ifPresent(v -> path.append("&projectId=").append(enc(v)));

        Optional<JsonNode> result = client.get(path.toString());
        if (result.isEmpty()) {
            return "Taint analysis unavailable for `" + source + "`.\n\n" +
                   "Ensure the method exists in the index (try lookup_symbol first).";
        }
        return McpResultFormatter.formatTaintResult(result.get());
    }

    private String runListVulns(JsonNode args) {
        String projectId = require(args, "projectId");
        var path = new StringBuilder("/api/v1/vulns?projectId=").append(enc(projectId));
        opt(args, "severity").ifPresent(v -> path.append("&severity=").append(enc(v)));
        opt(args, "status").ifPresent(v -> path.append("&status=").append(enc(v)));

        Optional<JsonNode> result = client.get(path.toString());
        if (result.isEmpty() || !result.get().isArray() || result.get().isEmpty()) {
            return "No vulnerability findings for project `" + projectId + "`.\n\n" +
                   "Run scan_vuln_code to scan for static patterns, or trace_taint for inter-procedural paths.";
        }
        return McpResultFormatter.formatVulnList(projectId, result.get());
    }

    private String runScanVulnCode(JsonNode args) {
        String projectId = require(args, "projectId");
        JsonNode result = client.post("/api/v1/vulns/scan/code?projectId=" + enc(projectId));
        int scanned  = result.path("scannedUnits").asInt(0);
        int findings = result.path("newFindings").asInt(0);
        return "## Code vulnerability scan complete\n\n" +
               "**Project:** `" + projectId + "`\n" +
               "**Units scanned:** " + scanned + "\n" +
               "**New findings:** " + findings + "\n\n" +
               (findings > 0
                   ? "Run `list_vulns` with `projectId=" + projectId + "` to review the findings."
                   : "No new findings. Existing findings (if any) are unchanged.");
    }

    private String runAnalyzeFlow(JsonNode args) {
        String target = require(args, "target");
        var path = new StringBuilder("/api/v1/flow/analyze?target=").append(enc(target));
        opt(args, "projectId").ifPresent(v -> path.append("&projectId=").append(enc(v)));

        Optional<JsonNode> result = client.get(path.toString());
        if (result.isEmpty()) {
            return "No flow analysis available for `" + target + "`.\n\n" +
                   "The symbol may not exist in the index, or its language is not yet supported " +
                   "(supported: Java, C, Python functions/methods with source available).";
        }
        return McpResultFormatter.formatFlowResult(result.get());
    }

    private String runLookupSymbol(JsonNode args) {
        String qn = require(args, "qualified_name");
        Optional<JsonNode> result = client.get("/api/v1/symbol/" + enc(qn));
        if (result.isEmpty()) {
            return "Symbol not found: `" + qn + "`\n\n" +
                   "The symbol may not have been indexed yet. Make sure repograph-app is running and the " +
                   "project has been indexed (`POST /api/v1/index/project`).";
        }
        return McpResultFormatter.formatUnit(result.get());
    }

    // ── 工具方法 ──────────────────────────────────────────────────────────────

    private String require(JsonNode args, String key) {
        String v = args.path(key).asText("").strip();
        if (v.isEmpty()) throw new IllegalArgumentException("Required argument missing: " + key);
        return v;
    }

    private Optional<String> opt(JsonNode args, String key) {
        String v = args.path(key).asText("").strip();
        return v.isEmpty() ? Optional.empty() : Optional.of(v);
    }

    private String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    private Map<String, Object> toolResult(String text, boolean isError) {
        return Map.of(
                "content", List.of(Map.of("type", "text", "text", text)),
                "isError", isError
        );
    }
}
