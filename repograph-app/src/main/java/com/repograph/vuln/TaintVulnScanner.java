package com.repograph.vuln;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.repograph.core.flow.TaintAnalysisService;
import com.repograph.core.flow.TaintHop;
import com.repograph.core.flow.TaintPath;
import com.repograph.core.flow.TaintResult;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 跨过程污点追踪漏洞扫描器，与 {@link CodeVulnScanner} 互补。
 *
 * <p>工作流程：
 * <ol>
 *   <li>从 Neo4j 取出项目内所有可扫描方法，筛选含 HTTP 映射注解的入口点；</li>
 *   <li>对每个入口点，用 JavaParser 解析参数注解，确定用户可控参数下标；</li>
 *   <li>调用 {@link TaintAnalysisService} 沿调用图传播污点；</li>
 *   <li>将命中已知 Sink 的路径转换为 {@link VulnFinding} 写入 {@link VulnStore}。</li>
 * </ol>
 *
 * <p>{@link CodeVulnScanner} 做方法内字符串匹配（快、有误报）；本扫描器做跨方法语义追踪
 * （慢但精确，能发现多跳污点链）。
 *
 * @author leolu
 * @since 0.6.0
 */
@Service
public class TaintVulnScanner {

    private static final Logger log = LoggerFactory.getLogger(TaintVulnScanner.class);

    /** 跨过程传播最大深度。 */
    private static final int DEFAULT_DEPTH = 6;

    /** 单次扫描最多处理的入口点数量，防止超大项目超时。 */
    private static final int MAX_ENTRY_POINTS = 80;

    /** 单条污染链步骤最多保留的源码字符数。 */
    private static final int MAX_SOURCE_EXCERPT_CHARS = 4_000;

    // ── 入口点 / 参数标识 ──────────────────────────────────────────────────────

    private static final List<String> ENTRY_ANNOTATIONS = List.of(
            "@requestmapping", "@getmapping", "@postmapping",
            "@putmapping", "@deletemapping", "@patchmapping"
    );

    private static final List<String> USER_PARAM_ANNOTATIONS = List.of(
            "@requestparam", "@pathvariable", "@requestbody",
            "@requestheader", "@matrixvariable", "@modelattribute"
    );

    /** 这些参数类型持有用户请求数据，视为污点源。 */
    private static final Set<String> HTTP_SOURCE_TYPES = Set.of(
            "httpservletrequest", "servletrequest", "multipartfile",
            "multipartrequest", "servletwebexchange"
    );

    /** 这些参数类型是响应/框架对象，不含用户输入——排除。 */
    private static final Set<String> NON_SOURCE_TYPES = Set.of(
            "httpservletresponse", "servletresponse", "model",
            "modelandview", "bindingresult", "errors",
            "redirectattributes", "sessionstatus"
    );

    // ── Sink → 规则映射 ────────────────────────────────────────────────────────

    private record SinkRule(String ruleId, String cwe, String severity, String title) {}

    private static final Map<String, SinkRule> SINK_RULES = Map.ofEntries(
            Map.entry("executeQuery",       new SinkRule("SQL_INJECTION_TAINT",     "CWE-89",  "HIGH",     "SQL 注入（跨过程污点路径）")),
            Map.entry("executeUpdate",      new SinkRule("SQL_INJECTION_TAINT",     "CWE-89",  "HIGH",     "SQL 注入（跨过程污点路径）")),
            Map.entry("executeBatch",       new SinkRule("SQL_INJECTION_TAINT",     "CWE-89",  "HIGH",     "SQL 注入（跨过程污点路径）")),
            Map.entry("executeLargeUpdate", new SinkRule("SQL_INJECTION_TAINT",     "CWE-89",  "HIGH",     "SQL 注入（跨过程污点路径）")),
            Map.entry("execute",            new SinkRule("SQL_INJECTION_TAINT",     "CWE-89",  "HIGH",     "SQL 注入（跨过程污点路径）")),
            Map.entry("exec",               new SinkRule("COMMAND_INJECTION_TAINT", "CWE-78",  "HIGH",     "命令注入（跨过程污点路径）")),
            Map.entry("start",              new SinkRule("COMMAND_INJECTION_TAINT", "CWE-78",  "HIGH",     "命令注入（跨过程污点路径）")),
            Map.entry("readObject",         new SinkRule("INSECURE_DESER_TAINT",    "CWE-502", "HIGH",     "不安全反序列化（跨过程污点路径）")),
            Map.entry("readUnshared",       new SinkRule("INSECURE_DESER_TAINT",    "CWE-502", "HIGH",     "不安全反序列化（跨过程污点路径）")),
            Map.entry("deserialize",        new SinkRule("INSECURE_DESER_TAINT",    "CWE-502", "HIGH",     "不安全反序列化（跨过程污点路径）")),
            Map.entry("loadClass",          new SinkRule("UNSAFE_REFLECTION_TAINT", "CWE-470", "HIGH",     "不安全反射（跨过程污点路径）")),
            Map.entry("forName",            new SinkRule("UNSAFE_REFLECTION_TAINT", "CWE-470", "HIGH",     "不安全反射（跨过程污点路径）")),
            Map.entry("invoke",             new SinkRule("UNSAFE_REFLECTION_TAINT", "CWE-470", "HIGH",     "不安全反射（跨过程污点路径）")),
            Map.entry("newInstance",        new SinkRule("UNSAFE_REFLECTION_TAINT", "CWE-470", "HIGH",     "不安全反射（跨过程污点路径）")),
            Map.entry("lookup",             new SinkRule("JNDI_INJECTION_TAINT",    "CWE-917", "CRITICAL", "JNDI 注入（跨过程污点路径）")),
            Map.entry("write",              new SinkRule("XSS_TAINT",               "CWE-79",  "MEDIUM",   "XSS（跨过程污点路径）")),
            Map.entry("print",              new SinkRule("XSS_TAINT",               "CWE-79",  "MEDIUM",   "XSS（跨过程污点路径）")),
            Map.entry("println",            new SinkRule("XSS_TAINT",               "CWE-79",  "MEDIUM",   "XSS（跨过程污点路径）")),
            Map.entry("sendRedirect",       new SinkRule("OPEN_REDIRECT_TAINT",     "CWE-601", "MEDIUM",   "开放重定向（跨过程污点路径）")),
            Map.entry("sendError",          new SinkRule("XSS_TAINT",               "CWE-79",  "MEDIUM",   "XSS（跨过程污点路径）")),
            Map.entry("parse",              new SinkRule("XXE_TAINT",               "CWE-611", "HIGH",     "XML 外部实体注入（跨过程污点路径）")),
            Map.entry("search",             new SinkRule("LDAP_INJECTION_TAINT",    "CWE-90",  "HIGH",     "LDAP 注入（跨过程污点路径）"))
    );

    private final GraphDiagnosticsService graphDiagnosticsService;
    private final TaintAnalysisService taintAnalysisService;
    private final VulnStore vulnStore;

    public TaintVulnScanner(GraphDiagnosticsService graphDiagnosticsService,
                            TaintAnalysisService taintAnalysisService,
                            VulnStore vulnStore) {
        this.graphDiagnosticsService = graphDiagnosticsService;
        this.taintAnalysisService    = taintAnalysisService;
        this.vulnStore               = vulnStore;
    }

    /** 扫描摘要：入口点数、分析路径数、写入发现数。 */
    public record ScanSummary(int entryPoints, int pathsAnalyzed, int newFindings) {}

    /**
     * 扫描指定项目：找 HTTP 入口点 → 识别用户可控参数 → 跨过程污点传播 → 写入发现。
     *
     * @param projectId 项目 ID
     * @return 扫描摘要
     */
    public ScanSummary scan(String projectId) {
        List<CodeUnit> allUnits = graphDiagnosticsService.listScanTargets(projectId);

        List<CodeUnit> entryPoints = allUnits.stream()
                .filter(u -> isHttpEntryPoint(u.rawSource()))
                .limit(MAX_ENTRY_POINTS)
                .toList();

        log.info("TaintVulnScanner: {} HTTP entry points (limit {}) in project {}",
                entryPoints.size(), MAX_ENTRY_POINTS, projectId);

        List<VulnFinding> findings = new ArrayList<>();
        Map<String, CodeUnit> unitsByQualifiedName = allUnits.stream()
                .collect(java.util.stream.Collectors.toMap(
                        CodeUnit::qualifiedName, unit -> unit, (left, right) -> left));
        Map<String, List<TaintEvidenceStep>> evidenceByFinding = new LinkedHashMap<>();
        String now = Instant.now().toString();
        int pathsAnalyzed = 0;

        for (CodeUnit entry : entryPoints) {
            List<Integer> paramIndices = userControlledParamIndices(entry.rawSource());
            if (paramIndices.isEmpty()) {
                log.debug("No user-controlled params detected: {}", entry.qualifiedName());
                continue;
            }

            for (int paramIdx : paramIndices) {
                TaintResult result = taintAnalysisService.analyzeTaint(
                        entry.qualifiedName(), paramIdx, projectId, DEFAULT_DEPTH);
                pathsAnalyzed += result.paths().size();

                // 同一 (entry, paramIdx, sinkName) 三元组只报一次
                Set<String> seenSinks = new HashSet<>();
                for (TaintPath path : result.paths()) {
                    if (!path.reachesSink()) continue;
                    String sinkName = extractSinkName(path.sinkDescription());
                    if (!seenSinks.add(entry.qualifiedName() + ":" + paramIdx + ":" + sinkName)) continue;

                    SinkRule rule = SINK_RULES.getOrDefault(sinkName,
                            new SinkRule("TAINT_SINK", "CWE-XX", "HIGH", "污点到达已知 Sink（跨过程污点路径）"));

                    String detail   = formatPath(entry.qualifiedName(), paramIdx, path);
                    String findingId = fingerprintId(projectId, rule.ruleId(), entry.id(),
                            String.valueOf(paramIdx), sinkName);

                    findings.add(new VulnFinding(
                            findingId, projectId, rule.ruleId(), rule.cwe(), rule.severity(),
                            VulnFinding.SUSPECTED,
                            entry.id(), entry.qualifiedName(), entry.filePath(), entry.startLine(),
                            rule.title(), detail, now));
                    evidenceByFinding.put(findingId,
                            buildEvidence(entry, paramIdx, path, unitsByQualifiedName));
                }
            }
        }

        vulnStore.upsertAll(findings);
        evidenceByFinding.forEach(vulnStore::replaceTaintEvidence);
        log.info("TaintVulnScanner: {} paths analyzed → {} findings written", pathsAnalyzed, findings.size());
        return new ScanSummary(entryPoints.size(), pathsAnalyzed, findings.size());
    }

    // ── 入口点检测 ──────────────────────────────────────────────────────────────

    static boolean isHttpEntryPoint(String rawSource) {
        if (rawSource == null) return false;
        String lower = rawSource.toLowerCase(Locale.ROOT);
        for (String ann : ENTRY_ANNOTATIONS) {
            if (lower.contains(ann)) return true;
        }
        return false;
    }

    // ── 用户可控参数下标检测 ────────────────────────────────────────────────────

    /**
     * 从 rawSource 中提取用户可控参数的下标列表。
     *
     * <p>策略（按优先级）：
     * <ol>
     *   <li>JavaParser 成功解析：找含 {@code @RequestParam/@PathVariable} 等注解的参数；</li>
     *   <li>有 {@code @RequestParam} 等但无具体下标：保守返回所有非响应类型参数；</li>
     *   <li>JavaParser 失败：字符串启发式估算参数数量并全部标记。</li>
     * </ol>
     */
    static List<Integer> userControlledParamIndices(String rawSource) {
        if (rawSource == null || rawSource.isBlank()) return List.of();

        try {
            JavaParser parser = new JavaParser(new ParserConfiguration()
                    .setLanguageLevel(ParserConfiguration.LanguageLevel.BLEEDING_EDGE));
            var parsed = parser.parseBodyDeclaration(rawSource).getResult().orElse(null);
            if (parsed instanceof CallableDeclaration<?> callable) {
                List<Parameter> params = callable.getParameters();
                List<Integer> annotated = new ArrayList<>();
                List<Integer> nonResponse = new ArrayList<>();

                for (int i = 0; i < params.size(); i++) {
                    Parameter p = params.get(i);
                    String pSrc  = p.toString().toLowerCase(Locale.ROOT);
                    String pType = p.getType().asString().toLowerCase(Locale.ROOT);

                    boolean hasSourceAnn = USER_PARAM_ANNOTATIONS.stream().anyMatch(pSrc::contains);
                    boolean isHttpSrc    = HTTP_SOURCE_TYPES.stream().anyMatch(pType::contains);
                    boolean isNonSrc     = NON_SOURCE_TYPES.stream().anyMatch(pType::contains);

                    if (hasSourceAnn || isHttpSrc) annotated.add(i);
                    if (!isNonSrc) nonResponse.add(i);
                }

                // 有明确注解：只扫注解参数；否则保守扫所有非响应参数
                return List.copyOf(annotated.isEmpty() ? nonResponse : annotated);
            }
        } catch (Exception ignored) {
            // fallthrough to heuristic
        }

        // 启发式降级：粗略统计参数数量，全部标记
        int count = estimateParamCount(rawSource);
        List<Integer> all = new ArrayList<>(count);
        for (int i = 0; i < count; i++) all.add(i);
        return List.copyOf(all);
    }

    /** 通过统计方法签名中顶层逗号数来估算参数个数。 */
    private static int estimateParamCount(String rawSource) {
        int open  = rawSource.indexOf('(');
        int close = rawSource.indexOf(')', open > 0 ? open : 0);
        if (open < 0 || close <= open) return 1;
        String sig = rawSource.substring(open + 1, close).trim();
        if (sig.isBlank()) return 0;
        int depth = 0, commas = 0;
        for (char c : sig.toCharArray()) {
            if (c == '<' || c == '(' || c == '[') depth++;
            else if (c == '>' || c == ')' || c == ']') depth--;
            else if (c == ',' && depth == 0) commas++;
        }
        return commas + 1;
    }

    // ── 路径格式化 ──────────────────────────────────────────────────────────────

    /** 从 "SINK:executeQuery.arg[0]" 中提取方法名 "executeQuery"。 */
    static String extractSinkName(String sinkDescription) {
        if (sinkDescription == null) return "";
        String s = sinkDescription.startsWith("SINK:") ? sinkDescription.substring(5) : sinkDescription;
        int dot = s.indexOf('.');
        return dot >= 0 ? s.substring(0, dot) : s;
    }

    /**
     * 将 {@link TaintPath} 格式化为人类可读的污点链字符串，作为 {@link VulnFinding#detail()}。
     *
     * <p>示例输出：
     * <pre>
     * 污点链：param[0] @ UserController#search →
     *   QueryBuilder#build [param[0]→return] →
     *   UserDao#findByName [param[0]→SINK:executeQuery.arg[0]]  ⚠ CWE-89
     * </pre>
     */
    static String formatPath(String entryQn, int paramIdx, TaintPath path) {
        StringBuilder sb = new StringBuilder();
        sb.append("污点链：param[").append(paramIdx).append("] @ ").append(simpleName(entryQn));
        for (TaintHop hop : path.hops()) {
            sb.append(" → ").append(simpleName(hop.methodQn()))
              .append(" [").append(hop.from()).append("→").append(hop.to()).append(']');
        }
        if (path.reachesSink()) {
            sb.append("  ⚠ ").append(path.sinkDescription());
        }
        return sb.toString();
    }

    private static List<TaintEvidenceStep> buildEvidence(
            CodeUnit entry, int paramIdx, TaintPath path, Map<String, CodeUnit> unitsByQualifiedName) {
        List<TaintEvidenceStep> steps = new ArrayList<>();
        String sourceTarget = path.hops().isEmpty() ? "" : path.hops().get(0).to().toString();
        steps.add(evidenceStep(
                1, "SOURCE", entry.qualifiedName(), "param[" + paramIdx + "]", sourceTarget, entry));
        int sequence = 2;
        for (TaintHop hop : path.hops()) {
            String role = hop.to().kind() == com.repograph.core.flow.TaintSlot.SlotKind.SINK
                    ? "SINK" : "PROPAGATION";
            steps.add(evidenceStep(
                    sequence++, role, hop.methodQn(), hop.from().toString(), hop.to().toString(),
                    unitsByQualifiedName.get(hop.methodQn())));
        }
        return List.copyOf(steps);
    }

    private static TaintEvidenceStep evidenceStep(
            int sequence, String role, String methodQn, String fromSlot, String toSlot, CodeUnit unit) {
        if (unit == null) {
            return new TaintEvidenceStep(
                    sequence, role, methodQn, fromSlot, toSlot, "", 0, 0, "");
        }
        String source = unit.rawSource() == null ? "" : unit.rawSource().strip();
        if (source.length() > MAX_SOURCE_EXCERPT_CHARS) {
            source = source.substring(0, MAX_SOURCE_EXCERPT_CHARS).stripTrailing();
        }
        return new TaintEvidenceStep(
                sequence, role, methodQn, fromSlot, toSlot,
                unit.filePath(), unit.startLine(), unit.endLine(), source);
    }

    private static String simpleName(String qn) {
        if (qn == null) return "?";
        int hash  = qn.indexOf('#');
        int paren = qn.indexOf('(', hash > 0 ? hash : 0);
        if (hash >= 0) {
            String method = paren > hash ? qn.substring(hash + 1, paren) : qn.substring(hash + 1);
            String cls    = qn.substring(0, hash);
            int dot = cls.lastIndexOf('.');
            return (dot >= 0 ? cls.substring(dot + 1) : cls) + "#" + method;
        }
        int dot = qn.lastIndexOf('.');
        return dot >= 0 ? qn.substring(dot + 1) : qn;
    }

    private static String fingerprintId(String... parts) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest(String.join(":", parts).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash).substring(0, 16);
        } catch (Exception e) {
            return String.join("", parts).substring(0, 16);
        }
    }
}
