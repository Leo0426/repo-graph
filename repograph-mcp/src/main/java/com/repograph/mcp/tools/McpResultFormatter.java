package com.repograph.mcp.tools;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 将 repograph-app REST API 的 JSON 响应渲染为 AI agent 可直接阅读的 Markdown 文本。
 *
 * @author leolu
 * @since 0.1.0
 */
final class McpResultFormatter {

    private McpResultFormatter() {}

    // ── GraphRAG 格式化 ───────────────────────────────────────────────────────

    static String formatGraphRagResult(String query, JsonNode r) {
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

    static String formatContextPack(JsonNode r) {
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

    static String formatTriageReports(String format, JsonNode reports) {
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

    static String formatTriageFeedback(JsonNode feedback) {
        return "- **Fingerprint:** `" + feedback.path("fingerprint").asText("?") + "`\n" +
               "- **Project:** `" + feedback.path("projectId").asText("?") + "`\n" +
               "- **Status:** " + feedback.path("status").asText("?") + "\n" +
               "- **Reviewer:** " + feedback.path("reviewer").asText("") + "\n" +
               "- **Reason:** " + feedback.path("reason").asText("") + "\n" +
               "- **Updated at:** " + feedback.path("updatedAt").asText("?");
    }

    static String formatTriageFeedbackList(String projectId, JsonNode feedbackItems) {
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

    static String formatTaintResult(JsonNode r) {
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

    private static String slotStr(JsonNode slot) {
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

    static String formatVulnList(String projectId, JsonNode vulns) {
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

    static String formatHealthReport(JsonNode r) {
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

    static String formatIndexStatus(String projectRoot, JsonNode r) {
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

    static String formatFlowResult(JsonNode r) {
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

    private static void appendListField(StringBuilder sb, String label, JsonNode arr) {
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

    static String formatSearchResults(String query, JsonNode response) {
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

    static String formatUnitList(String header, JsonNode units, String emptyMessage) {
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

    private static void appendUnit(StringBuilder sb, int idx, JsonNode u, String extra) {
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

    static String formatUnit(JsonNode u) {
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
}
