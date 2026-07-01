package com.repograph.mcp.tools;

import com.repograph.mcp.client.RepographApiClient;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * RepoGraph MCP 工具集，定义 5 个工具的 JSON Schema 并将工具调用转发至 repograph-app REST API。
 *
 * <p>工具输出为 AI agent 可直接阅读的 Markdown 格式文本。
 *
 * @author leolu
 * @since 0.1.0
 */
@Component
public class RepographMcpTools {

    private static final Logger log = LoggerFactory.getLogger(RepographMcpTools.class);

    private final RepographApiClient client;

    /** @param client repograph-app HTTP 客户端 */
    public RepographMcpTools(RepographApiClient client) {
        this.client = client;
    }

    // ── 工具定义 ─────────────────────────────────────────────────────────────

    private static final List<Map<String, Object>> TOOL_LIST = List.of(

        tool("search_semantic",
            "Search code units by natural language description. Returns semantically similar " +
            "code units with similarity scores. Use to find code implementing a concept, " +
            "framework pattern, or functionality (e.g. 'HTTP REST endpoint handler', " +
            "'database connection initialization', 'authentication filter').",
            schema(
                Map.of(
                    "query", strProp("Natural language description of what code to find"),
                    "lang",  strProp("Filter by language: java, c, or python"),
                    "kind",  strProp("Filter by kind: CLASS, METHOD, FUNCTION, INTERFACE, ENUM, CONSTRUCTOR, FIELD"),
                    "limit", intProp("Max results (default 10)", 1, 50, 10)
                ),
                List.of("query")
            )
        ),

        tool("find_callers",
            "Find all code units that call the specified symbol by traversing the call graph. " +
            "Use this to understand who uses a method, class, or function before changing it.",
            schema(
                Map.of(
                    "target", strProp("Fully qualified name of the symbol, e.g. 'com.example.Foo#bar(String)' " +
                                      "for methods or 'com.example.Foo' for classes/interfaces"),
                    "depth",  intProp("Call graph traversal depth — 1 = direct callers only (default 1)", 1, 5, 1)
                ),
                List.of("target")
            )
        ),

        tool("get_impact",
            "Analyze the blast radius if a symbol changes: returns all code units that " +
            "transitively depend on the target through calls, field types, or inheritance. " +
            "Use before refactoring to understand the full scope of required changes.",
            schema(
                Map.of(
                    "target", strProp("Fully qualified name of the symbol that is changing")
                ),
                List.of("target")
            )
        ),

        tool("lookup_symbol",
            "Get full details of a specific code unit by its fully qualified name: " +
            "signature, file location, annotations, metadata, parent type.",
            schema(
                Map.of(
                    "qualified_name", strProp("Fully qualified name, e.g. 'com.example.Service#findById(Long)'")
                ),
                List.of("qualified_name")
            )
        ),

        tool("search_code",
            "Find code units structurally similar to a given code snippet using code-vector embedding. " +
            "Use to find duplicate or similar implementations across the codebase.",
            schema(
                Map.of(
                    "snippet", strProp("Code snippet to find similar implementations for"),
                    "lang",    strProp("Filter by language: java, c, or python"),
                    "limit",   intProp("Max results (default 10)", 1, 50, 10)
                ),
                List.of("snippet")
            )
        ),

        tool("find_callees",
            "Find all code units that the specified symbol calls (outgoing CALLS edges). " +
            "Use to understand what a method depends on, trace execution flow forward, " +
            "or identify which components a function touches.",
            schema(
                Map.of(
                    "target", strProp("Fully qualified name of the caller, e.g. 'com.example.Service#process(String)'"),
                    "depth",  intProp("Traversal depth — 1 = direct callees only (default 1)", 1, 5, 1)
                ),
                List.of("target")
            )
        ),

        tool("find_subtypes",
            "Find all subclasses and implementations of a type (class or interface). " +
            "Use to discover who implements an interface, or who extends a base class, " +
            "before modifying contracts or shared behaviour.",
            schema(
                Map.of(
                    "target", strProp("Fully qualified name of the interface or class, " +
                                      "e.g. 'com.example.Repository' or 'com.example.BaseService'")
                ),
                List.of("target")
            )
        ),

        tool("locate_at",
            "Find the code unit (method, class, field …) that contains a specific line in a file. " +
            "Useful when you know a file path and line number from a stack trace or diff and want " +
            "the symbol's qualified name to use in other tools.",
            schema(
                Map.of(
                    "file", strProp("File path relative to the project root, e.g. 'src/main/java/com/example/Foo.java'"),
                    "line", intProp("1-based line number", 1, 100000, 1)
                ),
                List.of("file", "line")
            )
        ),

        tool("find_entrypoints",
            "List framework-annotated entry points (HTTP handlers, MyBatis mappers, JAX-RS resources, " +
            "C main functions, etc.). Useful for mapping out a service's public surface or as a starting " +
            "point for downstream callees/impact traversal.",
            schema(
                Map.of(
                    "projectId", strProp("Optional 12-char projectId to scope results; omit for all loaded projects"),
                    "lang",      strProp("Optional language filter: 'java' | 'c' | 'python'")
                ),
                List.of()
            )
        ),

        tool("analyze_flow",
            "Analyze intra-procedural control flow and data flow of a single function or method. " +
            "Returns a Control Flow Graph (CFG) showing all possible execution paths, a Data Flow Summary " +
            "(parameters, field reads/writes, return sources), and — for Java — a Program Dependence Graph (PDG). " +
            "Use this to understand branching logic, identify dead code paths, trace data through a function, " +
            "or verify that a taint source can reach a sink within one function body. " +
            "Java analysis is precise (AST-based); C and Python are conservative (precise=false, no PDG).",
            schema(
                Map.of(
                    "target",    strProp("Fully qualified name of the method or function, " +
                                         "e.g. 'com.example.Service#process(String)' or 'parse_input'"),
                    "projectId", strProp("Optional project ID to scope the symbol lookup")
                ),
                List.of("target")
            )
        ),

        tool("search_graphrag",
            "GraphRAG search: combines vector similarity, call-graph expansion, and security-aware " +
            "re-ranking into a single retrieval call. Starting from semantically similar seed results, " +
            "it expands along CALLS edges (callers and callees) and security-sensitive impact paths, " +
            "then boosts entry points, authentication, SQL execution, command execution, and " +
            "cryptographic operations. Each result is annotated with its origin (VECTOR / CALL_GRAPH / " +
            "IMPACT), relation to the query seed (SEED / CALLER / CALLEE / IMPACT), and raw source code. " +
            "Use this as the primary search when you need rich context: understanding how a feature is " +
            "implemented end-to-end, tracing a vulnerability path, or mapping the blast radius of a change. " +
            "Prefer search_semantic when you only need a quick symbol list without graph expansion.",
            schema(
                Map.of(
                    "query",           strProp("Natural language description of what to find"),
                    "lang",            strProp("Filter by language: java, c, or python"),
                    "projectId",       strProp("12-char project ID to scope the search"),
                    "limit",           intProp("Number of vector seed candidates (default 10)", 1, 20, 10),
                    "depth",           intProp("Call-graph expansion depth (default 1)", 1, 3, 1),
                    "callGraph",       boolProp("Expand along callers/callees (default true)"),
                    "impactExpansion", boolProp("Add security-sensitive impact nodes (default true)")
                ),
                List.of("query")
            )
        )
    );

    // ── 协议方法 ──────────────────────────────────────────────────────────────

    /**
     * 返回 tools/list 响应结构。
     *
     * @return {@code {"tools": [...]}} Map
     */
    public Map<String, Object> list() {
        return Map.of("tools", TOOL_LIST);
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
        return formatSearchResults("\"" + query + "\"", result.orElse(null));
    }

    private String runSearchCode(JsonNode args) {
        String snippet = require(args, "snippet");
        var path = new StringBuilder("/api/v1/search/code?snippet=").append(enc(snippet));
        opt(args, "lang").ifPresent(v -> path.append("&lang=").append(enc(v)));
        path.append("&limit=").append(args.path("limit").asInt(10));

        Optional<JsonNode> result = client.get(path.toString());
        String label = snippet.lines().findFirst().map(l -> "\"" + l.strip() + "\"").orElse("snippet");
        return formatSearchResults(label, result.orElse(null));
    }

    private String runFindCallers(JsonNode args) {
        String target = require(args, "target");
        int depth = args.path("depth").asInt(1);
        Optional<JsonNode> result = client.get(
                "/api/v1/graph/callers?target=" + enc(target) + "&depth=" + depth);
        return formatUnitList(
                "Callers of `" + target + "` (depth=" + depth + ")",
                result.orElse(null),
                "No callers found. The symbol may not exist or has no known callers in the indexed code."
        );
    }

    private String runGetImpact(JsonNode args) {
        String target = require(args, "target");
        Optional<JsonNode> result = client.get("/api/v1/graph/impact?target=" + enc(target));
        return formatUnitList(
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
        return formatUnitList(
                "Callees of `" + target + "` (depth=" + depth + ")",
                result.orElse(null),
                "No callees found. The symbol may not exist or makes no tracked calls."
        );
    }

    private String runFindSubtypes(JsonNode args) {
        String target = require(args, "target");
        Optional<JsonNode> result = client.get("/api/v1/graph/subtypes?target=" + enc(target));
        return formatUnitList(
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
        return formatUnitList(
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
        return "**Symbol at** `" + file + "` **line " + line + ":**\n\n" + formatUnit(result.get());
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
        return formatGraphRagResult(query, result.get());
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
        return formatFlowResult(result.get());
    }

    private String runLookupSymbol(JsonNode args) {
        String qn = require(args, "qualified_name");
        Optional<JsonNode> result = client.get("/api/v1/symbol/" + enc(qn));
        if (result.isEmpty()) {
            return "Symbol not found: `" + qn + "`\n\n" +
                   "The symbol may not have been indexed yet. Make sure repograph-app is running and the " +
                   "project has been indexed (`POST /api/v1/index/project`).";
        }
        return formatUnit(result.get());
    }

    // ── GraphRAG 格式化 ───────────────────────────────────────────────────────

    private String formatGraphRagResult(String query, JsonNode r) {
        JsonNode results = r.path("results");
        if (!results.isArray() || results.isEmpty()) {
            return "No GraphRAG results for \"" + query + "\".\n\n" +
                   "Try broadening the query or removing language/project filters.";
        }

        int seedCount    = r.path("seedCount").asInt(0);
        int cgExpanded   = r.path("callGraphExpanded").asInt(0);
        int impExpanded  = r.path("impactExpanded").asInt(0);
        int secHighlight = r.path("securityHighlightCount").asInt(0);

        var sb = new StringBuilder();
        sb.append("## GraphRAG search: \"").append(query).append("\"\n\n");
        sb.append("**Stats:** ")
          .append(seedCount).append(" vector seed(s)")
          .append(" + ").append(cgExpanded).append(" call-graph")
          .append(" + ").append(impExpanded).append(" impact")
          .append(" = ").append(results.size()).append(" total")
          .append("  |  ").append(secHighlight).append(" security-highlighted\n\n");

        for (int i = 0; i < results.size(); i++) {
            JsonNode ranked = results.get(i);
            JsonNode u      = ranked.path("unit");
            double finalScore  = ranked.path("finalScore").asDouble();
            double secScore    = ranked.path("securityScore").asDouble();
            String source      = ranked.path("source").asText("");
            String relation    = ranked.path("relation").asText("");
            JsonNode signals   = ranked.path("securitySignals");

            sb.append("### ").append(i + 1).append(". `")
              .append(u.path("qualifiedName").asText("?")).append("`\n");
            sb.append("**Kind:** ").append(u.path("kind").asText("?"))
              .append("  **Lang:** ").append(u.path("language").asText("?"))
              .append("  **Score:** ").append(String.format("%.3f", finalScore));
            if (secScore > 0.0) {
                sb.append("  **Security:** ").append(String.format("%.2f", secScore));
            }
            sb.append("  **Via:** ").append(source).append("/").append(relation).append("\n");
            sb.append("**File:** `").append(u.path("filePath").asText("?")).append("`")
              .append("  L").append(u.path("startLine").asInt())
              .append("–").append(u.path("endLine").asInt()).append("\n");

            String sig = u.path("signature").asText("");
            if (!sig.isBlank()) {
                sb.append("**Signature:** `").append(sig).append("`\n");
            }

            if (signals.isArray() && !signals.isEmpty()) {
                sb.append("**Security signals:**");
                signals.forEach(s -> sb.append(" `").append(s.asText()).append("`"));
                sb.append("\n");
            }

            String rawSource = u.path("rawSource").asText("");
            if (!rawSource.isBlank()) {
                String lang = u.path("language").asText("java");
                sb.append("\n```").append(lang).append("\n")
                  .append(rawSource).append("\n```\n");
            }
            sb.append("\n");
        }

        return sb.toString().stripTrailing();
    }

    // ── 流分析格式化 ──────────────────────────────────────────────────────────

    private String formatFlowResult(JsonNode r) {
        String target = r.path("target").asText("?");
        String lang = r.path("language").asText("?");
        boolean precise = r.path("precise").asBoolean(false);

        var sb = new StringBuilder();
        sb.append("## Flow analysis: `").append(target).append("`\n");
        sb.append("**Language:** ").append(lang)
          .append("  **Precise:** ").append(precise).append("\n\n");

        // 数据流摘要
        JsonNode summary = r.path("summary");
        if (!summary.isMissingNode()) {
            sb.append("### Data Flow Summary\n");
            appendListField(sb, "Parameters", summary.path("parameters"));
            appendListField(sb, "Field reads", summary.path("fieldReads"));
            appendListField(sb, "Field writes", summary.path("fieldWrites"));
            appendListField(sb, "Return sources", summary.path("returnSources"));
            sb.append("\n");
        }

        // 控制流图
        JsonNode cfg = r.path("controlFlowGraph");
        if (!cfg.isMissingNode()) {
            JsonNode nodes = cfg.path("nodes");
            JsonNode edges = cfg.path("edges");
            int nodeCount = nodes.isArray() ? nodes.size() : 0;
            int edgeCount = edges.isArray() ? edges.size() : 0;
            sb.append("### Control Flow Graph\n");
            sb.append(nodeCount).append(" nodes, ").append(edgeCount).append(" edges\n\n");

            if (nodes.isArray() && !nodes.isEmpty()) {
                sb.append("| ID | Kind | Label | Line |\n");
                sb.append("|----|------|-------|------|\n");
                for (JsonNode n : nodes) {
                    String label = n.path("label").asText("").replace("|", "\\|");
                    if (label.length() > 60) label = label.substring(0, 57) + "...";
                    sb.append("| ").append(n.path("id").asText())
                      .append(" | ").append(n.path("kind").asText())
                      .append(" | ").append(label)
                      .append(" | ").append(n.path("line").asInt()).append(" |\n");
                }
                sb.append("\n");
            }

            if (edges.isArray() && !edges.isEmpty()) {
                sb.append("**Edges:**\n");
                for (JsonNode e : edges) {
                    sb.append("- ").append(e.path("sourceId").asText())
                      .append(" → ").append(e.path("targetId").asText())
                      .append(" (").append(e.path("kind").asText()).append(")");
                    String sym = e.path("symbol").asText("");
                    if (!sym.isBlank()) sb.append(" `").append(sym).append("`");
                    sb.append("\n");
                }
                sb.append("\n");
            }
        }

        // PDG（仅 Java）
        JsonNode pdg = r.path("programDependenceGraph");
        if (!pdg.isNull() && !pdg.isMissingNode()) {
            JsonNode pdgEdges = pdg.path("edges");
            if (pdgEdges.isArray() && !pdgEdges.isEmpty()) {
                sb.append("### Program Dependence Graph\n");
                sb.append(pdgEdges.size()).append(" dependence edges\n\n");
                sb.append("**Edges:**\n");
                for (JsonNode e : pdgEdges) {
                    sb.append("- ").append(e.path("sourceId").asText())
                      .append(" → ").append(e.path("targetId").asText())
                      .append(" (").append(e.path("kind").asText()).append(")");
                    String sym = e.path("symbol").asText("");
                    if (!sym.isBlank()) sb.append(" `").append(sym).append("`");
                    sb.append("\n");
                }
                sb.append("\n");
            }
        }

        if (!precise) {
            sb.append("> **Note:** `precise=false` — CFG edges are conservative approximations; ");
            sb.append("field reads/writes may be incomplete.\n");
        }

        return sb.toString().stripTrailing();
    }

    private void appendListField(StringBuilder sb, String label, JsonNode arr) {
        if (!arr.isArray() || arr.isEmpty()) return;
        sb.append("- **").append(label).append(":** ");
        var it = arr.elements();
        while (it.hasNext()) {
            sb.append("`").append(it.next().asText()).append("`");
            if (it.hasNext()) sb.append(", ");
        }
        sb.append("\n");
    }

    // ── 输出格式化 ────────────────────────────────────────────────────────────

    private String formatSearchResults(String query, JsonNode response) {
        // 响应为 SearchPage{results:[], offset, limit, hasMore}，解包数组
        JsonNode results = (response != null && response.isObject())
                ? response.path("results") : response;
        if (results == null || !results.isArray() || results.isEmpty()) {
            return "No results found for " + query + ".\n\n" +
                   "Tips: broaden the query, check that the project is indexed, " +
                   "or try removing the lang/kind filter.";
        }
        boolean hasMore = response != null && response.path("hasMore").asBoolean(false);
        var sb = new StringBuilder();
        sb.append("Found ").append(results.size()).append(" result(s) for ").append(query);
        if (hasMore) sb.append(" (more available — increase limit or use offset)");
        sb.append(":\n\n");
        for (int i = 0; i < results.size(); i++) {
            JsonNode r = results.get(i);
            JsonNode u = r.path("unit");
            double score = r.path("score").asDouble();
            appendUnit(sb, i + 1, u, String.format("score: %.4f", score));
        }
        return sb.toString().stripTrailing();
    }

    private String formatUnitList(String header, JsonNode units, String emptyMessage) {
        if (units == null || !units.isArray() || units.isEmpty()) {
            return header + "\n\n" + emptyMessage;
        }
        var sb = new StringBuilder();
        sb.append(header).append("\n").append(units.size()).append(" code unit(s):\n\n");
        for (int i = 0; i < units.size(); i++) {
            appendUnit(sb, i + 1, units.get(i), null);
        }
        return sb.toString().stripTrailing();
    }

    private void appendUnit(StringBuilder sb, int idx, JsonNode u, String extra) {
        sb.append(idx).append(". [").append(u.path("kind").asText("?")).append("] ")
          .append(u.path("qualifiedName").asText("?"));
        if (extra != null) sb.append(" — ").append(extra);
        sb.append("\n");
        sb.append("   File: ").append(u.path("filePath").asText("?"))
          .append("  L").append(u.path("startLine").asInt(0))
          .append("–").append(u.path("endLine").asInt(0)).append("\n");
        String sig = u.path("signature").asText("");
        if (!sig.isBlank()) sb.append("   Signature: ").append(sig).append("\n");
        sb.append("\n");
    }

    private String formatUnit(JsonNode u) {
        var sb = new StringBuilder();
        sb.append("**Symbol:** `").append(u.path("qualifiedName").asText()).append("`\n");
        sb.append("**Kind:** ").append(u.path("kind").asText())
          .append("  **Language:** ").append(u.path("language").asText()).append("\n");
        sb.append("**File:** `").append(u.path("filePath").asText("?")).append("`")
          .append("  L").append(u.path("startLine").asInt())
          .append("–").append(u.path("endLine").asInt()).append("\n");

        String sig = u.path("signature").asText("");
        if (!sig.isBlank()) sb.append("**Signature:** `").append(sig).append("`\n");

        JsonNode anns = u.path("annotations");
        if (anns.isArray() && !anns.isEmpty()) {
            sb.append("**Annotations:**");
            anns.forEach(a -> sb.append(" `").append(a.asText()).append("`"));
            sb.append("\n");
        }

        JsonNode meta = u.path("metadata");
        if (meta.isObject() && meta.size() > 0) {
            sb.append("**Metadata:**");
            meta.fields().forEachRemaining(e ->
                    sb.append(" `").append(e.getKey()).append("=").append(e.getValue().asText()).append("`"));
            sb.append("\n");
        }

        String parent = u.path("parentQualifiedName").asText("");
        if (!parent.isBlank()) sb.append("**Defined in:** `").append(parent).append("`\n");

        String source = u.path("rawSource").asText("");
        if (!source.isBlank()) {
            String lang = u.path("language").asText("java");
            sb.append("\n```").append(lang).append("\n").append(source).append("\n```\n");
        }

        return sb.toString().stripTrailing();
    }

    // ── JSON Schema 构建 ──────────────────────────────────────────────────────

    private static Map<String, Object> tool(String name, String desc, Map<String, Object> schema) {
        return Map.of("name", name, "description", desc, "inputSchema", schema);
    }

    private static Map<String, Object> schema(Map<String, Object> props, List<String> required) {
        var m = new LinkedHashMap<String, Object>();
        m.put("type", "object");
        m.put("properties", props);
        m.put("required", required);
        return m;
    }

    private static Map<String, Object> strProp(String desc) {
        return Map.of("type", "string", "description", desc);
    }

    private static Map<String, Object> intProp(String desc, int min, int max, int dflt) {
        return Map.of("type", "integer", "description", desc,
                      "minimum", min, "maximum", max, "default", dflt);
    }

    private static Map<String, Object> boolProp(String desc) {
        return Map.of("type", "boolean", "description", desc);
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
