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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * RepoGraph MCP 工具集，定义工具 JSON Schema 并将工具调用转发至 repograph-app REST API。
 *
 * <p>工具输出为 AI agent 可直接阅读的 Markdown 格式文本。
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

        tool("search_keyword",
            "Search code units by exact-ish keyword matching over qualified names, signatures, and raw source. " +
            "Use this for identifiers, method names, configuration keys, rule IDs, CWE/CVE IDs, package names, " +
            "or API names where vector search may be unstable.",
            schema(
                Map.of(
                    "query", strProp("Keyword query, e.g. CWE-78 Runtime.exec requestMapping"),
                    "lang",  strProp("Filter by language: java, c, python, or doc"),
                    "kind",  strProp("Filter by kind: CLASS, METHOD, FUNCTION, DOCUMENT, INTERFACE, ENUM, CONSTRUCTOR, FIELD"),
                    "projectId", strProp("12-char project ID to scope the search"),
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
        ),

        tool("build_context_pack",
            "Build a citation-ready context pack for an LLM Agent. This wraps GraphRAG results into " +
            "numbered evidence blocks with file paths, line ranges, source/relation metadata, raw source " +
            "excerpts, budget truncation notes, and retrieval stats. Use this when you need to answer, " +
            "review, or reason with traceable context instead of just listing matching symbols.",
            schema(
                Map.of(
                    "query",           strProp("Natural language description of the needed context"),
                    "taskType",        strProp("Task type, e.g. detail, security, summary, compare"),
                    "budgetChars",     intProp("Total excerpt character budget (default 12000)", 1000, 60000, 12000),
                    "lang",            strProp("Filter by language: java, c, python, or doc"),
                    "projectId",       strProp("12-char project ID to scope the context pack"),
                    "limit",           intProp("Number of vector seed candidates (default 10)", 1, 20, 10),
                    "depth",           intProp("Call-graph expansion depth (default 1)", 1, 3, 1),
                    "callGraph",       boolProp("Expand along callers/callees (default true)"),
                    "impactExpansion", boolProp("Add security-sensitive impact nodes (default true)")
                ),
                List.of("query")
            )
        ),

        tool("triage_finding",
            "Analyze external SAST findings and produce citation-backed triage reports. Accepts Semgrep " +
            "or SARIF/CodeQL JSON, imports findings, builds RepoGraph context, and returns verdicts, " +
            "confidence, evidence, missing information, remediation guidance, and Markdown suitable for " +
            "an issue or PR comment. Use this after a scanner has produced alerts.",
            schema(
                Map.of(
                    "format",      strProp("Finding format: semgrep, sarif, or codeql"),
                    "json",        strProp("Raw JSON output from the SAST tool"),
                    "projectId",   strProp("Optional 12-char project ID to scope retrieval"),
                    "budgetChars", intProp("Per-finding context budget (default 12000)", 1000, 60000, 12000),
                    "maxFindings", intProp("Max findings to triage from this request (default 10)", 1, 50, 10)
                ),
                List.of("format", "json")
            )
        ),

        tool("record_triage_feedback",
            "Record human review feedback for a SAST triage report. Use this after a reviewer confirms " +
            "whether a triaged finding is a true positive, false positive, still needs review, or is fixed. " +
            "Feedback is keyed by the finding fingerprint returned by triage_finding.",
            schema(
                Map.of(
                    "fingerprint", strProp("Finding fingerprint returned by triage_finding"),
                    "projectId",   strProp("12-char project ID associated with the finding"),
                    "status",      strProp("TRUE_POSITIVE, FALSE_POSITIVE, NEEDS_REVIEW, or FIXED"),
                    "reviewer",    strProp("Reviewer name, handle, or automation ID"),
                    "reason",      strProp("Short reason or evidence for the feedback decision")
                ),
                List.of("fingerprint", "projectId", "status")
            )
        ),

        tool("list_triage_feedback",
            "List recorded SAST triage feedback for a project, optionally filtered by status. Use this " +
            "to review false positives, confirmed risks, fixed findings, or outstanding manual review work.",
            schema(
                Map.of(
                    "projectId", strProp("12-char project ID"),
                    "status",    strProp("Optional filter: TRUE_POSITIVE, FALSE_POSITIVE, NEEDS_REVIEW, or FIXED")
                ),
                List.of("projectId")
            )
        ),

        tool("list_projects",
            "List all code projects currently indexed in RepoGraph. " +
            "Returns each project's ID (required by most other tools), root path, node count, and " +
            "last index timestamp. Call this first when you don't know which projectId to use.",
            schema(Map.of(), List.of())
        ),

        tool("trace_taint",
            "Perform inter-procedural taint analysis starting from a specific method parameter. " +
            "Traces how tainted data flows across method call boundaries, following CALLS edges " +
            "until it reaches a known Sink (SQL execution, OS command, deserialization, HTTP output, " +
            "reflection, JNDI lookup) or the analysis depth limit. " +
            "Use after search_graphrag identifies a suspicious entry point to confirm whether user " +
            "input can reach a dangerous operation.",
            schema(
                Map.of(
                    "source",     strProp("Fully qualified name of the taint source method, " +
                                          "e.g. 'com.example.Controller#submit(String)'"),
                    "paramIndex", intProp("0-based index of the tainted parameter (default 0)", 0, 20, 0),
                    "projectId",  strProp("12-char project ID to scope the analysis"),
                    "maxDepth",   intProp("Max call-graph hops to follow (default 6)", 1, 15, 6)
                ),
                List.of("source")
            )
        ),

        tool("list_vulns",
            "List vulnerability findings stored in RepoGraph for a project. " +
            "Findings come from three scanners: static rule patterns (CodeVulnScanner), " +
            "inter-procedural taint paths (TaintVulnScanner), and dependency CVEs (DepsVulnScanner). " +
            "Filter by severity (CRITICAL/HIGH/MEDIUM/LOW) or status (SUSPECTED/CONFIRMED/FIXED/DISMISSED). " +
            "Use to review existing findings before triggering a new scan, or to build a security report.",
            schema(
                Map.of(
                    "projectId", strProp("12-char project ID (required)"),
                    "severity",  strProp("Filter by severity: CRITICAL, HIGH, MEDIUM, or LOW"),
                    "status",    strProp("Filter by status: SUSPECTED, CONFIRMED, FIXED, or DISMISSED")
                ),
                List.of("projectId")
            )
        ),

        tool("scan_vuln_code",
            "Trigger a static code vulnerability scan on an indexed project using built-in CWE rules. " +
            "Scans all method bodies for patterns matching: SQL injection, command injection, " +
            "path traversal, XSS, insecure deserialization, weak crypto, sensitive data logging, " +
            "SSRF, and open redirect (9 rules total). " +
            "Returns a summary with the number of units scanned and new findings discovered. " +
            "For inter-procedural taint paths use trace_taint instead.",
            schema(
                Map.of(
                    "projectId", strProp("12-char project ID of the project to scan")
                ),
                List.of("projectId")
            )
        ),

        tool("get_health_report",
            "Get a comprehensive health report for an indexed project in a single call. " +
            "Returns: health score (0–100), vulnerability counts by severity, " +
            "top 5 most complex methods with qualifiedName (pass directly to analyze_flow), " +
            "top 5 most unstable couplings, package cycles, dead code count, and test gap count. " +
            "Use this at the start of any analysis session to orient yourself before diving into " +
            "specific tools. A low health score indicates where to focus first.",
            schema(
                Map.of(
                    "projectId", strProp("12-char project ID (use list_projects to find it)")
                ),
                List.of("projectId")
            )
        ),

        tool("trigger_index",
            "Trigger background indexing of a project directory. Indexing parses source files " +
            "(Java / C / Python / Markdown), builds the Neo4j code graph, and generates vector " +
            "embeddings via Ollama. Returns immediately (async) — large codebases may take " +
            "several minutes due to embedding. Use index_status to poll for completion. " +
            "After indexing finishes, all RepoGraph MCP tools become available for the new project.",
            schema(
                Map.of(
                    "projectRoot", strProp("Absolute path to the project root directory on the server"),
                    "lang",        strProp("Comma-separated language filter: java, c, python (omit for all)"),
                    "strategy",    strProp("Parse strategy: auto, precise, or heuristic (default: auto)")
                ),
                List.of("projectRoot")
            )
        ),

        tool("index_status",
            "Check the indexing progress or result for a project root. " +
            "Returns status (running / done / idle), file counts, unit/edge counts, " +
            "duration, and any errors. Call repeatedly after trigger_index until " +
            "status is 'done', then use list_projects to get the projectId for other tools.",
            schema(
                Map.of(
                    "projectRoot", strProp("Absolute path used in trigger_index, " +
                                           "e.g. '/Users/me/myproject'")
                ),
                List.of("projectRoot")
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
        return formatSearchResults("\"" + query + "\"", result.orElse(null));
    }

    private String runSearchKeyword(JsonNode args) {
        String query = require(args, "query");
        var path = new StringBuilder("/api/v1/search/keyword?q=").append(enc(query));
        opt(args, "lang").ifPresent(v -> path.append("&lang=").append(enc(v)));
        opt(args, "kind").ifPresent(v -> path.append("&kind=").append(enc(v)));
        opt(args, "projectId").ifPresent(v -> path.append("&projectId=").append(enc(v)));
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

    private String runGetHealthReport(JsonNode args) {
        String projectId = require(args, "projectId");
        Optional<JsonNode> result = client.get("/api/v1/metrics/report?projectId=" + enc(projectId));
        if (result.isEmpty()) {
            return "No health report for project `" + projectId + "`.\n\n" +
                   "Ensure the project is indexed — use `list_projects` to verify.";
        }
        return formatHealthReport(result.get());
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
        return formatIndexStatus(projectRoot, result.get());
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
        return formatContextPack(result.get());
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
        return formatTriageReports(format, result);
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
        return "## Triage feedback recorded\n\n" + formatTriageFeedback(result);
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
        return formatTriageFeedbackList(projectId, result.get());
    }

    private String runListProjects() {
        Optional<JsonNode> result = client.get("/api/v1/projects");
        if (result.isEmpty() || !result.get().isArray() || result.get().isEmpty()) {
            return "No projects indexed yet.\n\n" +
                   "Run `repograph index <path>` or `POST /api/v1/index/project` to index a codebase.";
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
        return formatTaintResult(result.get());
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
        return formatVulnList(projectId, result.get());
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
        int keywordSeeds = r.path("keywordSeedCount").asInt(0);
        int cgExpanded   = r.path("callGraphExpanded").asInt(0);
        int impExpanded  = r.path("impactExpanded").asInt(0);
        int secHighlight = r.path("securityHighlightCount").asInt(0);

        var sb = new StringBuilder();
        sb.append("## GraphRAG search: \"").append(query).append("\"\n\n");
        sb.append("**Stats:** ")
          .append(seedCount).append(" vector seed(s)")
          .append(" + ").append(keywordSeeds).append(" keyword")
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

    private String formatContextPack(JsonNode r) {
        String query = r.path("query").asText("");
        String taskType = r.path("taskType").asText("detail");
        JsonNode evidence = r.path("evidence");
        if (!evidence.isArray() || evidence.isEmpty()) {
            return "No context evidence for \"" + query + "\".\n\n" +
                   "Try broadening the query or increasing budgetChars.";
        }

        var sb = new StringBuilder();
        sb.append("## Context Pack: \"").append(query).append("\"\n\n");
        sb.append("**Task:** `").append(taskType).append("`")
          .append("  **Budget:** ").append(r.path("usedBudgetChars").asInt(0))
          .append("/").append(r.path("requestedBudgetChars").asInt(0)).append(" chars")
          .append("  **Stats:** ").append(r.path("seedCount").asInt(0)).append(" seed(s), ")
          .append(r.path("keywordSeedCount").asInt(0)).append(" keyword, ")
          .append(r.path("callGraphExpanded").asInt(0)).append(" call-graph, ")
          .append(r.path("impactExpanded").asInt(0)).append(" impact\n\n");

        for (JsonNode e : evidence) {
            sb.append("### [").append(e.path("citationId").asText("?")).append("] `")
              .append(e.path("qualifiedName").asText("?")).append("`\n");
            sb.append("**Kind:** ").append(e.path("kind").asText("?"))
              .append("  **Lang:** ").append(e.path("language").asText("?"))
              .append("  **Via:** ").append(e.path("source").asText(""))
              .append("/").append(e.path("relation").asText(""))
              .append("  **Score:** ").append(String.format("%.3f", e.path("finalScore").asDouble()))
              .append("\n");
            sb.append("**File:** `").append(e.path("filePath").asText("?")).append("`")
              .append("  L").append(e.path("startLine").asInt())
              .append("–").append(e.path("endLine").asInt());
            if (e.path("truncated").asBoolean(false)) {
                sb.append("  **Truncated:** true");
            }
            sb.append("\n");

            JsonNode signals = e.path("securitySignals");
            if (signals.isArray() && !signals.isEmpty()) {
                sb.append("**Security signals:**");
                signals.forEach(s -> sb.append(" `").append(s.asText()).append("`"));
                sb.append("\n");
            }

            String lang = e.path("language").asText("java");
            sb.append("\n```").append(lang).append("\n")
              .append(e.path("excerpt").asText("")).append("\n```\n\n");
        }

        JsonNode omitted = r.path("omittedReasons");
        if (omitted.isArray() && !omitted.isEmpty()) {
            sb.append("### Omitted\n");
            omitted.forEach(o -> sb.append("- ").append(o.asText()).append("\n"));
        }

        return sb.toString().stripTrailing();
    }

    private String formatTriageReports(String format, JsonNode reports) {
        if (reports == null || !reports.isArray() || reports.isEmpty()) {
            return "No triage reports generated for `" + format + "` input.\n\n" +
                   "Check that the JSON contains findings and that the format is supported.";
        }

        var sb = new StringBuilder();
        sb.append("## SAST triage reports (`").append(format).append("`)\n\n");
        sb.append("Generated ").append(reports.size()).append(" report(s).\n\n");

        for (int i = 0; i < reports.size(); i++) {
            JsonNode item = reports.get(i);
            JsonNode report = item.path("report");
            JsonNode finding = report.path("finding");
            sb.append("### ").append(i + 1).append(". `")
              .append(finding.path("ruleId").asText("?")).append("`")
              .append(" → ").append(report.path("verdict").asText("?"))
              .append(" (confidence ")
              .append(String.format("%.2f", report.path("confidence").asDouble(0.0)))
              .append(")\n");
            sb.append("**Fingerprint:** `").append(item.path("fingerprint").asText("?")).append("`\n");
            sb.append("**Location:** `").append(finding.path("filePath").asText("?"))
              .append(":").append(finding.path("startLine").asInt()).append("`");
            String qn = report.path("locatedQualifiedName").asText("");
            if (!qn.isBlank()) {
                sb.append("  **Symbol:** `").append(qn).append("`");
            }
            sb.append("\n");
            String cwe = finding.path("cwe").asText("");
            if (!cwe.isBlank()) {
                sb.append("**CWE:** ").append(cwe).append("  ");
            }
            sb.append("**Severity:** ").append(finding.path("severity").asText("UNKNOWN")).append("\n\n");

            String summary = report.path("developerSummary").asText("");
            if (!summary.isBlank()) {
                sb.append(summary).append("\n\n");
            }

            JsonNode reasons = report.path("reasons");
            if (reasons.isArray() && !reasons.isEmpty()) {
                sb.append("**Reasons:**\n");
                reasons.forEach(reason -> sb.append("- ").append(reason.asText()).append("\n"));
                sb.append("\n");
            }

            JsonNode missing = report.path("missingInfo");
            if (missing.isArray() && !missing.isEmpty()) {
                sb.append("**Missing info:**\n");
                missing.forEach(info -> sb.append("- ").append(info.asText()).append("\n"));
                sb.append("\n");
            }

            String remediation = report.path("remediation").asText("");
            if (!remediation.isBlank()) {
                sb.append("**Remediation:** ").append(remediation).append("\n\n");
            }

            String markdown = item.path("markdown").asText("");
            if (!markdown.isBlank()) {
                sb.append("<details>\n<summary>Markdown report</summary>\n\n")
                  .append(markdown).append("\n</details>\n\n");
            }
        }

        return sb.toString().stripTrailing();
    }

    private String formatTriageFeedback(JsonNode feedback) {
        return "- **Fingerprint:** `" + feedback.path("fingerprint").asText("?") + "`\n" +
               "- **Project:** `" + feedback.path("projectId").asText("?") + "`\n" +
               "- **Status:** " + feedback.path("status").asText("?") + "\n" +
               "- **Reviewer:** " + feedback.path("reviewer").asText("") + "\n" +
               "- **Reason:** " + feedback.path("reason").asText("") + "\n" +
               "- **Updated at:** " + feedback.path("updatedAt").asText("?");
    }

    private String formatTriageFeedbackList(String projectId, JsonNode feedbackItems) {
        var sb = new StringBuilder();
        sb.append("## Triage feedback for `").append(projectId).append("` (")
          .append(feedbackItems.size()).append(")\n\n");
        sb.append("| fingerprint | status | reviewer | reason | updated at |\n");
        sb.append("|-------------|--------|----------|--------|------------|\n");
        for (JsonNode feedback : feedbackItems) {
            sb.append("| `").append(feedback.path("fingerprint").asText("?")).append("`")
              .append(" | ").append(feedback.path("status").asText("?"))
              .append(" | ").append(feedback.path("reviewer").asText(""))
              .append(" | ").append(feedback.path("reason").asText("").replace("|", "\\|"))
              .append(" | ").append(feedback.path("updatedAt").asText("?"))
              .append(" |\n");
        }
        return sb.toString().stripTrailing();
    }

    // ── 安全工具格式化 ────────────────────────────────────────────────────────

    private String formatTaintResult(JsonNode r) {
        String source = r.path("sourceMethod").asText("?");
        int paramIdx  = r.path("sourceParamIndex").asInt(0);
        JsonNode paths = r.path("paths");
        int analyzed  = r.path("methodsAnalyzed").asInt(0);
        boolean truncated = r.path("truncated").asBoolean(false);

        var sb = new StringBuilder();
        sb.append("## Taint analysis: `").append(source).append("` param[").append(paramIdx).append("]\n\n");
        sb.append("**Methods analyzed:** ").append(analyzed);
        if (truncated) sb.append("  ⚠ truncated (depth/path limit reached)");
        sb.append("\n\n");

        if (!paths.isArray() || paths.isEmpty()) {
            sb.append("No taint paths found — tainted input does not appear to reach a known Sink " +
                      "within the analysis depth.\n");
            return sb.toString().stripTrailing();
        }

        sb.append("**Taint paths found:** ").append(paths.size()).append("\n\n");
        for (int i = 0; i < paths.size(); i++) {
            JsonNode p = paths.get(i);
            boolean sink = p.path("reachesSink").asBoolean(false);
            String sinkDesc = p.path("sinkDescription").asText("");
            sb.append("### Path ").append(i + 1);
            if (sink) sb.append("  🔴 SINK REACHED: `").append(sinkDesc).append("`");
            sb.append("\n");

            JsonNode hops = p.path("hops");
            if (hops.isArray()) {
                for (JsonNode hop : hops) {
                    String from = slotStr(hop.path("from"));
                    String to   = slotStr(hop.path("to"));
                    sb.append("- `").append(hop.path("methodQn").asText("?"))
                      .append("` : ").append(from).append(" → ").append(to).append("\n");
                }
            }
            sb.append("\n");
        }

        return sb.toString().stripTrailing();
    }

    private String slotStr(JsonNode slot) {
        String kind = slot.path("kind").asText("");
        int index   = slot.path("index").asInt(-1);
        String hint = slot.path("calleeHint").asText("");
        return switch (kind) {
            case "PARAM"    -> "param[" + index + "]";
            case "RETURN"   -> "return";
            case "CALL_ARG" -> hint + ".arg[" + index + "]";
            case "SINK"     -> "SINK:" + hint + ".arg[" + index + "]";
            default         -> kind;
        };
    }

    private String formatVulnList(String projectId, JsonNode vulns) {
        var sb = new StringBuilder();
        sb.append("## Vulnerabilities — project `").append(projectId).append("`\n\n");
        sb.append(vulns.size()).append(" finding(s):\n\n");

        for (int i = 0; i < vulns.size(); i++) {
            JsonNode v = vulns.get(i);
            String severity = v.path("severity").asText("?");
            String status   = v.path("status").asText("?");
            String icon = switch (severity) {
                case "CRITICAL" -> "🔴";
                case "HIGH"     -> "🟠";
                case "MEDIUM"   -> "🟡";
                default         -> "🔵";
            };
            sb.append(i + 1).append(". ").append(icon).append(" **[").append(severity).append("]** ")
              .append(v.path("title").asText(v.path("ruleId").asText("?")))
              .append(" — ").append(status).append("\n");
            sb.append("   `").append(v.path("qualifiedName").asText("?")).append("`")
              .append("  File: `").append(v.path("filePath").asText("?")).append("`")
              .append(" L").append(v.path("startLine").asInt()).append("\n");
            String detail = v.path("detail").asText("");
            if (!detail.isBlank()) sb.append("   ").append(detail).append("\n");
            sb.append("   CWE: ").append(v.path("cwe").asText("N/A"))
              .append("  ID: `").append(v.path("id").asText()).append("`\n\n");
        }

        return sb.toString().stripTrailing();
    }

    // ── 健康报告 & 索引格式化 ─────────────────────────────────────────────────

    private String formatHealthReport(JsonNode r) {
        int score = r.path("healthScore").asInt(0);
        String icon = score >= 80 ? "🟢" : score >= 50 ? "🟡" : score >= 30 ? "🟠" : "🔴";
        String projectId = r.path("projectId").asText("?");

        var sb = new StringBuilder();
        sb.append("## Health report: `").append(projectId).append("`\n\n");
        sb.append("**Health score:** ").append(icon).append(" **").append(score).append(" / 100**\n");
        sb.append("**Units:** ").append(r.path("totalUnits").asInt())
          .append("  **Files:** ").append(r.path("totalFiles").asInt())
          .append("  **Edges:** ").append(r.path("totalEdges").asInt()).append("\n\n");

        int crit = r.path("vulnCritical").asInt(0);
        int high = r.path("vulnHigh").asInt(0);
        int med  = r.path("vulnMedium").asInt(0);
        int low  = r.path("vulnLow").asInt(0);
        if (crit + high + med + low > 0) {
            sb.append("### Vulnerabilities\n");
            if (crit > 0) sb.append("- 🔴 CRITICAL: ").append(crit).append("\n");
            if (high > 0) sb.append("- 🟠 HIGH: ").append(high).append("\n");
            if (med  > 0) sb.append("- 🟡 MEDIUM: ").append(med).append("\n");
            if (low  > 0) sb.append("- 🔵 LOW: ").append(low).append("\n");
            sb.append("\nRun `list_vulns` with `projectId=").append(projectId)
              .append("` to review findings.\n\n");
        }

        sb.append("### Code quality\n");
        sb.append("- High-complexity methods (CC > 10): ")
          .append(r.path("highComplexityMethods").asInt()).append("\n");
        sb.append("- High-instability classes: ")
          .append(r.path("highInstabilityClasses").asInt()).append("\n");
        sb.append("- Package cycles: ").append(r.path("packageCycles").asInt()).append("\n");
        sb.append("- Dead code units: ").append(r.path("deadCodeCount").asInt()).append("\n");
        sb.append("- Test gaps: ").append(r.path("testGapCount").asInt())
          .append(" / ").append(r.path("totalProductionMethods").asInt())
          .append(" production methods\n\n");

        JsonNode topComplex = r.path("topComplexMethods");
        if (topComplex.isArray() && !topComplex.isEmpty()) {
            sb.append("### Top complex methods\n");
            for (JsonNode m : topComplex) {
                sb.append("- `").append(m.path("qualifiedName").asText())
                  .append("` CC=").append(m.path("complexity").asInt())
                  .append("  `").append(m.path("filePath").asText()).append("`\n");
            }
            sb.append("\n→ Use `analyze_flow` on any method above for CFG/PDG details.\n\n");
        }

        JsonNode topUnstable = r.path("topInstableCouplings");
        if (topUnstable.isArray() && !topUnstable.isEmpty()) {
            sb.append("### Top unstable couplings\n");
            for (JsonNode c : topUnstable) {
                sb.append("- `").append(c.path("classQualifiedName").asText())
                  .append("` I=").append(String.format("%.2f", c.path("instability").asDouble()))
                  .append("  fan-in=").append(c.path("fanIn").asInt())
                  .append(" fan-out=").append(c.path("fanOut").asInt()).append("\n");
            }
            sb.append("\n");
        }

        return sb.toString().stripTrailing();
    }

    private String formatIndexStatus(String projectRoot, JsonNode r) {
        String status = r.path("status").asText("unknown");
        var sb = new StringBuilder();
        sb.append("## Index status: `").append(projectRoot).append("`\n\n");
        sb.append("**Status:** ").append(status).append("\n");

        if ("running".equals(status)) {
            int total  = r.path("totalFiles").asInt(0);
            int parsed = r.path("parsedFiles").asInt(0);
            if (total > 0) {
                sb.append("**Progress:** ").append(parsed).append(" / ")
                  .append(total).append(" files\n");
            }
            sb.append("\nIndexing in progress — call `index_status` again to check for completion.\n");
        } else if ("done".equals(status)) {
            sb.append("**Units indexed:** ").append(r.path("totalUnits").asInt())
              .append("  **Edges:** ").append(r.path("totalEdges").asInt()).append("\n");
            sb.append("**Files:** ").append(r.path("totalFiles").asInt()).append("\n");
            long ms = r.path("durationMs").asLong(0);
            sb.append("**Duration:** ").append(ms / 1000).append("s\n");
            sb.append("**Indexed at:** ").append(r.path("indexedAt").asText("")).append("\n");
            JsonNode errors = r.path("errors");
            if (errors.isArray() && !errors.isEmpty()) {
                sb.append("\n⚠ **").append(errors.size()).append(" error(s) during indexing:**\n");
                for (JsonNode e : errors) sb.append("- ").append(e.asText()).append("\n");
            }
            sb.append("\nIndexing complete. Use `list_projects` to get the projectId for other tools.\n");
        } else {
            sb.append("\nProject has not been indexed yet. Call `trigger_index` to start.\n");
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
            String extra = String.format("score: %.4f", score);
            JsonNode terms = r.path("matchedTerms");
            if (terms.isArray() && !terms.isEmpty()) {
                StringBuilder matched = new StringBuilder();
                terms.forEach(t -> {
                    if (!matched.isEmpty()) matched.append(", ");
                    matched.append(t.asText());
                });
                extra += " matched: " + matched;
            }
            appendUnit(sb, i + 1, u, extra);
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
