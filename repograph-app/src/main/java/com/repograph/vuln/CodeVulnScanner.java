package com.repograph.vuln;

import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * 代码漏洞扫描器，对指定项目的所有方法/函数/构造器运行内置规则，将发现写入 {@link VulnStore}。
 *
 * <p>扫描完全基于静态字符串匹配（rawSource），不调用外部服务，速度通常在秒级以内。
 * 所有发现以 {@code SUSPECTED} 状态写入，需人工 {@code CONFIRMED} 后才计入报告。
 *
 * <h3>内置规则</h3>
 * <ul>
 *   <li>SQL_INJECTION (CWE-89, HIGH) — Statement + executeQuery/Update 含字符串拼接</li>
 *   <li>COMMAND_INJECTION (CWE-78, HIGH) — Runtime.exec / ProcessBuilder</li>
 *   <li>INSECURE_DESERIALIZATION (CWE-502, HIGH) — ObjectInputStream.readObject</li>
 *   <li>WEAK_CRYPTO (CWE-327, MEDIUM) — MD5/SHA-1 in MessageDigest.getInstance</li>
 *   <li>HARDCODED_SECRET (CWE-798, HIGH) — 字面量直接赋给 password/secret/token/key 变量</li>
 *   <li>PATH_TRAVERSAL (CWE-22, HIGH) — 用户输入拼入 File/Paths 路径</li>
 *   <li>XXE_INJECTION (CWE-611, HIGH) — XML 解析器未禁用外部实体</li>
 *   <li>INSECURE_RANDOM (CWE-330, MEDIUM) — 安全场景使用 java.util.Random</li>
 *   <li>SENSITIVE_LOG (CWE-200, MEDIUM) — 日志输出包含密码/令牌等敏感字段</li>
 * </ul>
 *
 * @author leolu
 * @since 0.5.0
 */
@Service
public class CodeVulnScanner {

    private final GraphDiagnosticsService graphQueryService;
    private final VulnStore vulnStore;

    private record Rule(
            String ruleId, String cwe, String severity, String title,
            Predicate<String> matches, Function<String, String> detail) {}

    private static final List<Rule> RULES = List.of(

        new Rule("SQL_INJECTION", "CWE-89", "HIGH",
                "SQL 注入风险（Statement 字符串拼接）",
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    boolean hasExec = s.contains(".executequery(") || s.contains(".executeupdate(")
                            || s.contains(".execute(\"") || s.contains(".execute(sql");
                    boolean hasConcat = s.contains("\" +") || s.contains("+ \"")
                            || s.contains("+ " + "'") || s.contains("string.format(");
                    // 当直接使用 Statement（而非 PreparedStatement）拼接时标记
                    boolean notPrepared = !s.contains("preparedstatement") && !s.contains("preparestatement(");
                    return hasExec && (hasConcat || notPrepared);
                },
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    if (s.contains("\" +") || s.contains("+ \"")) return "检测到 SQL 字符串拼接";
                    return "检测到 Statement.execute* 调用（非 PreparedStatement）";
                }),

        new Rule("COMMAND_INJECTION", "CWE-78", "HIGH",
                "命令注入风险（Runtime.exec / ProcessBuilder）",
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    return s.contains("runtime.getruntime().exec(")
                            || s.contains("runtime.getruntime( ).exec(")
                            || s.contains("new processbuilder(");
                },
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    if (s.contains("runtime.getruntime().exec(")) return "使用 Runtime.getRuntime().exec()";
                    return "使用 new ProcessBuilder()";
                }),

        new Rule("INSECURE_DESERIALIZATION", "CWE-502", "HIGH",
                "不安全反序列化（ObjectInputStream.readObject）",
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    return s.contains(".readobject()") || s.contains("objectinputstream");
                },
                src -> "检测到 ObjectInputStream / readObject() 调用"),

        new Rule("WEAK_CRYPTO", "CWE-327", "MEDIUM",
                "弱加密算法（MD5 / SHA-1）",
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    return s.contains("\"md5\"") || s.contains("\"sha-1\"")
                            || s.contains("\"sha1\"") || s.contains("(\"md5\")");
                },
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    if (s.contains("\"md5\"") || s.contains("(\"md5\")")) return "使用 MD5 算法";
                    return "使用 SHA-1 算法";
                }),

        new Rule("HARDCODED_SECRET", "CWE-798", "HIGH",
                "硬编码敏感信息（password / secret / token / key）",
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    return (s.contains("password") || s.contains("secret")
                            || s.contains("apikey") || s.contains("privatekey")
                            || s.contains("accesstoken") || s.contains("credential"))
                            && (s.contains("= \"") || s.contains("= '"));
                },
                src -> "检测到敏感字段名与字符串字面量赋值"),

        new Rule("PATH_TRAVERSAL", "CWE-22", "HIGH",
                "路径穿越风险（用户输入拼入文件路径）",
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    boolean hasFileOp = s.contains("new file(") || s.contains("paths.get(")
                            || s.contains("path.of(") || s.contains("filechannel")
                            || s.contains("fileinputstream(") || s.contains("fileoutputstream(");
                    if (!hasFileOp) return false;
                    // 表示路径来自用户输入
                    boolean hasUserInput = s.contains("getparameter(") || s.contains("getpathinfo(")
                            || s.contains("getheader(") || s.contains("requestparam")
                            || s.contains("pathvariable") || s.contains("../")
                            || s.contains("..\\\\");
                    return hasUserInput;
                },
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    if (s.contains("../") || s.contains("..\\\\")) return "检测到路径中的目录遍历序列 ../";
                    return "文件路径操作与用户输入参数（getParameter / @PathVariable 等）出现在同一方法中";
                }),

        new Rule("XXE_INJECTION", "CWE-611", "HIGH",
                "XML 外部实体注入风险（未禁用外部实体解析）",
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    boolean hasParser = s.contains("documentbuilderfactory")
                            || s.contains("saxparserfactory") || s.contains("xmlinputfactory")
                            || s.contains("transformer factory") || s.contains("transformerfactory");
                    if (!hasParser) return false;
                    // 若安全功能未被显式禁用则视为不安全
                    boolean hasSecureConfig = s.contains("disallow-doctype-decl")
                            || s.contains("external-general-entities")
                            || s.contains("external-parameter-entities")
                            || s.contains("setfeature(javax.xml")
                            || s.contains("setfeature(http://apache");
                    return !hasSecureConfig;
                },
                src -> "创建 XML 解析器时未调用 setFeature 禁用外部实体，可能遭受 XXE 攻击"),

        new Rule("INSECURE_RANDOM", "CWE-330", "MEDIUM",
                "不安全随机数（安全场景使用 java.util.Random）",
                src -> {
                    String s = src.toLowerCase(Locale.ROOT);
                    boolean hasRandom = s.contains("new random()") || s.contains("new java.util.random()")
                            || s.contains("math.random()");
                    if (!hasRandom) return false;
                    // 仅当方法名或上下文与安全相关时才标记
                    boolean securityContext = s.contains("token") || s.contains("password")
                            || s.contains("secret") || s.contains("nonce") || s.contains("salt")
                            || s.contains("session") || s.contains("key") || s.contains("auth")
                            || s.contains("otp") || s.contains("captcha") || s.contains("uuid");
                    return securityContext;
                },
                src -> "安全相关方法中使用了 java.util.Random，应改用 java.security.SecureRandom"),

        new Rule("SENSITIVE_LOG", "CWE-200", "MEDIUM",
                "敏感信息写入日志（password / token / secret）",
                src -> {
                    // 行级匹配：日志调用与敏感关键字必须出现在同一行
                    for (String line : src.toLowerCase(Locale.ROOT).split("\n")) {
                        boolean hasLog = line.contains("log.info(") || line.contains("log.debug(")
                                || line.contains("log.warn(") || line.contains("log.error(")
                                || line.contains("logger.info(") || line.contains("logger.debug(")
                                || line.contains("logger.warn(") || line.contains("logger.error(")
                                || line.contains("system.out.print") || line.contains("system.err.print");
                        if (!hasLog) continue;
                        if (line.contains("password") || line.contains("passwd")
                                || line.contains("secret") || line.contains("token")
                                || line.contains("apikey") || line.contains("credential")
                                || line.contains("privatekey") || line.contains("accesskey")) {
                            return true;
                        }
                    }
                    return false;
                },
                src -> "日志语句中检测到敏感字段名（password/token/secret 等），可能导致敏感数据泄露到日志文件")
    );

    public CodeVulnScanner(GraphDiagnosticsService graphQueryService, VulnStore vulnStore) {
        this.graphQueryService = graphQueryService;
        this.vulnStore = vulnStore;
    }

    /**
     * 扫描指定项目的所有方法/函数/构造器，将命中规则的结果写入 {@link VulnStore}。
     *
     * @param projectId 项目 ID
     * @return 本次扫描的统计摘要
     */
    public ScanSummary scan(String projectId) {
        List<CodeUnit> targets = graphQueryService.listScanTargets(projectId);
        List<VulnFinding> findings = new ArrayList<>();
        String now = Instant.now().toString();

        for (CodeUnit unit : targets) {
            String src = unit.rawSource();
            if (src == null || src.isBlank()) continue;
            for (Rule rule : RULES) {
                if (rule.matches().test(src)) {
                    String findingId = fingerprintId(projectId, rule.ruleId(), unit.id());
                    findings.add(new VulnFinding(
                            findingId,
                            projectId,
                            rule.ruleId(),
                            rule.cwe(),
                            rule.severity(),
                            VulnFinding.SUSPECTED,
                            unit.id(),
                            unit.qualifiedName(),
                            unit.filePath(),
                            unit.startLine(),
                            rule.title(),
                            rule.detail().apply(src),
                            now));
                }
            }
        }

        vulnStore.upsertAll(findings);
        return new ScanSummary(targets.size(), findings.size());
    }

    /** 扫描结果摘要。 */
    public record ScanSummary(int scannedUnits, int newFindings) {}

    // ── 内部方法 ──────────────────────────────────────────────────────────────

    private static String fingerprintId(String projectId, String ruleId, String unitId) {
        try {
            String raw = projectId + ":" + ruleId + ":" + unitId;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(raw.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash).substring(0, 16);
        } catch (Exception e) {
            return projectId + ruleId + unitId;
        }
    }
}
