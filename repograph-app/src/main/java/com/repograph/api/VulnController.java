package com.repograph.api;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.repograph.vuln.CodeVulnScanner;
import com.repograph.vuln.DepsVulnScanner;
import com.repograph.vuln.TaintVulnScanner;
import com.repograph.vuln.VulnFinding;
import com.repograph.vuln.VulnReport;
import com.repograph.vuln.VulnStore;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 漏洞管理 REST API。
 *
 * <ul>
 *   <li>{@code POST /api/v1/vulns/scan/code?projectId=} — 触发代码漏洞扫描（同步，秒级）</li>
 *   <li>{@code POST /api/v1/vulns/scan/deps?projectId=&projectRoot=} — 触发依赖漏洞扫描</li>
 *   <li>{@code GET  /api/v1/vulns?projectId=&severity=&status=} — 列出发现记录</li>
 *   <li>{@code PUT  /api/v1/vulns/{id}/status?status=} — 更新发现状态</li>
 *   <li>{@code GET  /api/v1/vulns/{id}/impact} — 查询单条漏洞的代码影响面（调用链）</li>
 *   <li>{@code GET  /api/v1/vulns/report/{projectId}} — 生成项目漏洞报告</li>
 * </ul>
 *
 * @author leolu
 * @since 0.5.0
 */
@RestController
@RequestMapping("/api/v1/vulns")
public class VulnController {

    private final CodeVulnScanner scanner;
    private final DepsVulnScanner depsScanner;
    private final TaintVulnScanner taintScanner;
    private final com.repograph.vuln.PreciseTaintScanService preciseTaintScanner;
    private final VulnStore vulnStore;
    private final GraphQueryService graphQueryService;

    public VulnController(CodeVulnScanner scanner, DepsVulnScanner depsScanner,
                          TaintVulnScanner taintScanner,
                          com.repograph.vuln.PreciseTaintScanService preciseTaintScanner,
                          VulnStore vulnStore, GraphQueryService graphQueryService) {
        this.scanner       = scanner;
        this.depsScanner   = depsScanner;
        this.taintScanner  = taintScanner;
        this.preciseTaintScanner = preciseTaintScanner;
        this.vulnStore     = vulnStore;
        this.graphQueryService = graphQueryService;
    }

    /**
     * 触发代码漏洞扫描，对项目所有方法/函数/构造器运行内置规则。
     */
    @PostMapping("/scan/code")
    public ResponseEntity<Map<String, Object>> scanCode(@RequestParam String projectId) {
        if (projectId == null || projectId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "projectId is required"));
        }
        CodeVulnScanner.ScanSummary summary = scanner.scan(projectId);
        return ResponseEntity.ok(Map.of(
                "projectId",    projectId,
                "scannedUnits", summary.scannedUnits(),
                "newFindings",  summary.newFindings()
        ));
    }

    /**
     * 触发跨过程污点追踪扫描：从 HTTP 入口参数出发，沿调用图传播，报告到达已知 Sink 的路径。
     * 比代码扫描慢（秒~分钟级），但能检测跨方法的多跳漏洞。
     */
    @PostMapping("/scan/taint")
    public ResponseEntity<Map<String, Object>> scanTaint(@RequestParam String projectId) {
        if (projectId == null || projectId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "projectId is required"));
        }
        TaintVulnScanner.ScanSummary summary = taintScanner.scan(projectId);
        return ResponseEntity.ok(Map.of(
                "projectId",     projectId,
                "entryPoints",   summary.entryPoints(),
                "pathsAnalyzed", summary.pathsAnalyzed(),
                "newFindings",   summary.newFindings()
        ));
    }

    /**
     * 触发精确污点扫描(方案 A:WALA IFDS 引擎独立进程)。
     * <p>
     * 引擎在编译后的字节码上做跨过程 field-sensitive 污点分析,精度高于 {@code /scan/taint}
     * 的源码级启发式,但要求目标可编译并提供编译产物路径,且引擎跑在带 jmods 的 JDK
     * (见 repograph.taint.precise 配置)。
     *
     * @param projectId    项目 ID
     * @param classpath    编译后的 classes 目录或 jar(WALA 分析目标)
     * @param config       source/sink 配置 JSON 文件路径
     * @param rule         规则名(默认 CWE_78)
     * @param entryMethods 可选:入口方法名(逗号分隔);省略则用全部 public 方法
     */
    @PostMapping("/scan/taint/precise")
    public ResponseEntity<Map<String, Object>> scanTaintPrecise(
            @RequestParam String projectId,
            @RequestParam String classpath,
            @RequestParam String config,
            @RequestParam(defaultValue = "CWE_78") String rule,
            @RequestParam(required = false) String entryMethods) {
        if (projectId == null || projectId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "projectId is required"));
        }
        if (classpath == null || classpath.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "classpath is required"));
        }
        if (config == null || config.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "config is required"));
        }
        var summary = preciseTaintScanner.scan(projectId, classpath, config, rule, entryMethods);
        return ResponseEntity.ok(Map.of(
                "projectId",   projectId,
                "flows",       summary.flows(),
                "newFindings", summary.newFindings()
        ));
    }

    /**
     * 触发依赖漏洞扫描，解析 pom.xml 生成 SBOM 后与内置 Advisory 数据库比对。
     *
     * @param projectId   项目 ID
     * @param projectRoot 项目根目录绝对路径（含 pom.xml）
     */
    @PostMapping("/scan/deps")
    public ResponseEntity<Map<String, Object>> scanDeps(
            @RequestParam String projectId,
            @RequestParam String projectRoot) {
        if (projectId == null || projectId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "projectId is required"));
        }
        if (projectRoot == null || projectRoot.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "projectRoot is required"));
        }
        DepsVulnScanner.ScanSummary summary = depsScanner.scan(projectId, Path.of(projectRoot));
        return ResponseEntity.ok(Map.of(
                "projectId",         projectId,
                "scannedComponents", summary.scannedComponents(),
                "newFindings",       summary.newFindings()
        ));
    }

    /**
     * 列出指定项目的漏洞发现，可按严重程度和状态过滤。
     */
    @GetMapping
    public List<VulnFinding> list(
            @RequestParam String projectId,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String status) {
        return vulnStore.list(projectId, severity, status);
    }

    /**
     * 更新单条发现记录的状态（CONFIRMED / FIXED / DISMISSED / SUSPECTED）。
     *
     * @return 200 OK；400 status 非法；404 id 不存在
     */
    @PutMapping("/{id}/status")
    public ResponseEntity<Map<String, String>> updateStatus(
            @PathVariable String id,
            @RequestParam String status) {
        String upper = status == null ? "" : status.toUpperCase();
        if (!VulnFinding.VALID_STATUSES.contains(upper)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Invalid status: " + status,
                                 "valid", String.join(", ", VulnFinding.VALID_STATUSES)));
        }
        if (!vulnStore.updateStatus(id, upper)) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(Map.of("id", id, "status", upper));
    }

    /**
     * 查询单条漏洞发现的代码影响面：沿调用图追溯所有依赖该漏洞方法的调用方。
     *
     * <p>使用 {@link GraphQueryService#impactAnalysis} 在图中遍历，返回可能受该漏洞波及的所有
     * 代码单元，便于评估修复优先级和影响范围。
     *
     * @param id 漏洞发现记录 ID
     * @return 影响面 CodeUnit 列表；404 若发现不存在
     */
    @GetMapping("/{id}/impact")
    public ResponseEntity<List<CodeUnit>> impact(@PathVariable String id) {
        return vulnStore.findById(id)
                .map(f -> {
                    List<CodeUnit> affected = List.copyOf(
                            graphQueryService.impactAnalysis(f.qualifiedName(), f.projectId()));
                    return ResponseEntity.ok(affected);
                })
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * 生成指定项目的漏洞报告，包含统计摘要和所有已确认（CONFIRMED）发现的完整列表。
     *
     * @param projectId 目标项目 ID
     * @return 结构化漏洞报告
     */
    @GetMapping("/report/{projectId}")
    public VulnReport report(@PathVariable String projectId) {
        List<VulnFinding> all       = vulnStore.list(projectId, null, null);
        List<VulnFinding> confirmed = vulnStore.list(projectId, null, VulnFinding.CONFIRMED);

        Map<String, Long> bySeverity = countBy(all, VulnFinding::severity);
        Map<String, Long> byStatus   = countBy(all, VulnFinding::status);
        Map<String, Long> byCwe      = countBy(all, VulnFinding::cwe);

        return new VulnReport(
                projectId,
                Instant.now().toString(),
                all.size(),
                bySeverity,
                byStatus,
                byCwe,
                confirmed);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private static <T> Map<String, Long> countBy(
            List<VulnFinding> findings,
            java.util.function.Function<VulnFinding, String> keyFn) {
        return findings.stream()
                .collect(Collectors.groupingBy(keyFn, LinkedHashMap::new, Collectors.counting()));
    }
}
