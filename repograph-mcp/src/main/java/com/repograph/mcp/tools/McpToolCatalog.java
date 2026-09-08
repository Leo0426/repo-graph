package com.repograph.mcp.tools;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * RepoGraph MCP 工具的 JSON Schema 目录：每个工具的名称、描述与入参定义。
 *
 * @author leolu
 * @since 0.1.0
 */
final class McpToolCatalog {

    private McpToolCatalog() {}

    static final List<Map<String, Object>> TOOL_LIST = List.of(

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
}
