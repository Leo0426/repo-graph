package com.repograph.vuln;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * 精确污点扫描服务(方案 A:独立进程引擎)。
 * <p>
 * 以子进程方式在带 jmods 的 JDK(配置项 {@code repograph.taint.precise.javaHome})上运行
 * WALA IFDS 引擎的 {@code TaintScanCli},读取其 JSON 输出并映射为 {@link VulnFinding} 写入
 * {@link VulnStore}。app 本身跑 JDK 25(FFM/tree-sitter),与引擎的 JDK 需求解耦。
 *
 * @see PreciseTaintProperties
 */
@Service
public class PreciseTaintScanService {

    private static final Logger log = LoggerFactory.getLogger(PreciseTaintScanService.class);
    private static final String CLI_MAIN = "com.repograph.taint.cli.TaintScanCli";

    private final PreciseTaintProperties props;
    private final VulnStore vulnStore;
    private final ObjectMapper mapper = new ObjectMapper();

    public PreciseTaintScanService(PreciseTaintProperties props, VulnStore vulnStore) {
        this.props = props;
        this.vulnStore = vulnStore;
    }

    /** 扫描摘要:是否命中流、写入发现数。 */
    public record ScanSummary(int flows, int newFindings) {}

    /**
     * 在编译后的 classpath 上运行精确污点扫描。
     *
     * @param projectId    项目 ID(用于关联发现)
     * @param classpath    编译后的 classes 目录或 jar(WALA 分析目标)
     * @param configPath   source/sink 配置 JSON 文件路径
     * @param ruleName     规则名(如 CWE_78)
     * @param entryMethods 入口方法名(逗号分隔);为空则用引擎默认(全部 public 方法)
     * @return 扫描摘要
     */
    public ScanSummary scan(String projectId, String classpath, String configPath,
                            String ruleName, String entryMethods) {
        if (!props.isEnabled()) {
            throw new IllegalStateException(
                "精确污点扫描未启用:请配置 repograph.taint.precise.{enabled,javaHome,engineLibDir}");
        }
        try {
            JsonNode result = invokeEngine(classpath, configPath, ruleName, entryMethods);
            List<VulnFinding> findings = mapFindings(projectId, ruleName, result);
            vulnStore.upsertAll(findings);
            int flowCount = result.path("flowCount").asInt(findings.size());
            log.info("PreciseTaintScan: project={} flows={} findings={}", projectId, flowCount, findings.size());
            return new ScanSummary(flowCount, findings.size());
        } catch (Exception e) {
            throw new RuntimeException("精确污点扫描失败: " + e.getMessage(), e);
        }
    }

    /** 启动引擎子进程,返回解析后的 JSON 根节点。 */
    private JsonNode invokeEngine(String classpath, String configPath,
                                  String ruleName, String entryMethods) throws Exception {
        String javaBin = props.getJavaHome().isBlank()
            ? "java" : Path.of(props.getJavaHome(), "bin", "java").toString();
        String libGlob = Path.of(props.getEngineLibDir(), "*").toString();
        Path out = Files.createTempFile("precise-taint-", ".json");

        List<String> cmd = new ArrayList<>(List.of(
            javaBin, "-cp", libGlob, CLI_MAIN,
            "--classpath", classpath,
            "--config", configPath,
            "--rule", ruleName,
            "--out", out.toString()));
        if (!props.getExclusions().isBlank()) {
            cmd.add("--exclusions");
            cmd.add(props.getExclusions());
        }
        if (entryMethods != null && !entryMethods.isBlank()) {
            cmd.add("--entry-methods");
            cmd.add(entryMethods);
        }

        log.info("PreciseTaintScan launching engine: {}", String.join(" ", cmd));
        Process p = new ProcessBuilder(cmd).redirectErrorStream(false).start();
        boolean done = p.waitFor(props.getTimeoutSeconds(), TimeUnit.SECONDS);
        if (!done) {
            p.destroyForcibly();
            throw new IllegalStateException("引擎子进程超时(" + props.getTimeoutSeconds() + "s)");
        }
        if (p.exitValue() != 0) {
            String err = new String(p.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            throw new IllegalStateException("引擎子进程失败(exit=" + p.exitValue() + "): " + err);
        }
        String json = Files.readString(out, StandardCharsets.UTF_8);
        Files.deleteIfExists(out);
        return mapper.readTree(json);
    }

    private List<VulnFinding> mapFindings(String projectId, String ruleName, JsonNode result) {
        String now = Instant.now().toString();
        String cwe = toCwe(ruleName);
        List<VulnFinding> findings = new ArrayList<>();
        Set<String> seen = new java.util.HashSet<>();

        for (JsonNode flow : result.path("flows")) {
            String sourceSig = flow.path("sourceSignature").asText("");
            String sinkSig = flow.path("sinkSignature").asText("");
            String sinkClass = flow.path("sinkClass").asText("");
            int line = flow.path("sourceLine").asInt(-1);
            String detail = flow.path("detail").asText("");

            String id = fingerprint(projectId, ruleName, sourceSig, sinkSig);
            if (!seen.add(id)) continue;

            findings.add(new VulnFinding(
                id, projectId, "PRECISE_" + ruleName, cwe, "HIGH",
                VulnFinding.SUSPECTED,
                "", sinkClass, "", line,
                ruleName + " 精确污点(IFDS 跨过程)",
                detail.isBlank() ? (sourceSig + " -> " + sinkSig) : detail,
                now));
        }
        return findings;
    }

    /** CWE_78 -> CWE-78;非 CWE 规则原样返回。 */
    private static String toCwe(String ruleName) {
        return ruleName != null && ruleName.startsWith("CWE_")
            ? "CWE-" + ruleName.substring(4) : ruleName;
    }

    private static String fingerprint(String... parts) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(String.join("|", parts).getBytes(StandardCharsets.UTF_8));
            byte[] d = md.digest();
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 12; i++) sb.append(String.format("%02x", d[i]));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(String.join("|", parts).hashCode());
        }
    }
}
