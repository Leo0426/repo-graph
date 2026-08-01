package com.repograph.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.ReportSnapshot;
import com.repograph.core.finding.ReviewQueueAuditEvent;
import com.repograph.core.finding.ReviewQueueEntry;
import com.repograph.core.finding.ReviewQueueEntryNotFoundException;
import com.repograph.core.finding.ReviewStatus;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
import com.repograph.core.retrieval.ContextPackOptions;
import com.repograph.core.retrieval.GraphRagOptions;
import com.repograph.finding.ExternalFindingImporter;
import com.repograph.finding.FindingContextService;
import com.repograph.finding.ReportPdfRenderer;
import com.repograph.finding.ReviewQueueStore;
import com.repograph.finding.TriageReportService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.info.BuildProperties;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

/**
 * 审核队列 REST API：把批量研判结果固化为报告快照并生成待审条目，
 * 支持认领/退回/确认/驳回及 Markdown/JSON 导出。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/review-queue")
public class ReviewQueueController {

    private static final int MAX_FINDINGS_PER_REQUEST = 50;
    private static final int MIN_BUDGET_CHARS = 1000;
    private static final int MAX_BUDGET_CHARS = 60000;

    private final List<ExternalFindingImporter> importers;
    private final FindingContextService findingContextService;
    private final TriageReportService triageReportService;
    private final ReviewQueueStore reviewQueueStore;
    private final BuildProperties buildProperties;
    private final ObjectMapper objectMapper;
    private final ReportPdfRenderer reportPdfRenderer;

    /**
     * 创建审核队列 REST 控制器。
     *
     * @param importers             可用的外部报警导入器
     * @param findingContextService 报警上下文构建服务
     * @param triageReportService   研判报告生成服务
     * @param reviewQueueStore      审核队列及快照存储
     * @param buildProperties       应用构建信息，用于填充快照的工具版本
     * @param objectMapper          快照 JSON 导出使用的 Jackson mapper
     * @param reportPdfRenderer     报告 PDF 渲染器
     */
    public ReviewQueueController(
            List<ExternalFindingImporter> importers,
            FindingContextService findingContextService,
            TriageReportService triageReportService,
            ReviewQueueStore reviewQueueStore,
            BuildProperties buildProperties,
            ObjectMapper objectMapper,
            ReportPdfRenderer reportPdfRenderer) {
        this.importers = importers;
        this.findingContextService = findingContextService;
        this.triageReportService = triageReportService;
        this.reviewQueueStore = reviewQueueStore;
        this.buildProperties = buildProperties;
        this.objectMapper = objectMapper;
        this.reportPdfRenderer = reportPdfRenderer;
    }

    /**
     * 上传外部工具报警 JSON，研判后生成一份冻结的报告快照并提交到审核队列。
     *
     * @param format      报警格式，如 {@code semgrep}、{@code sarif}
     * @param projectId   项目 ID
     * @param codeVersion 当前代码版本，写入快照
     * @param ruleVersion 当前规则版本，写入快照
     * @param budgetChars 单条报告的上下文字符预算
     * @param maxFindings 单次请求最多处理的报警数
     * @param request     HTTP 请求，报警 JSON 从请求输入流读取
     * @return 快照标识及生成的队列条目
     * @throws IOException 请求体读取失败
     */
    @PostMapping("/snapshots")
    public SubmitSnapshotResponse submitSnapshot(
            @RequestParam String format,
            @RequestParam String projectId,
            @RequestParam(required = false) String codeVersion,
            @RequestParam(required = false) String ruleVersion,
            @RequestParam(defaultValue = "12000") int budgetChars,
            @RequestParam(defaultValue = "10") int maxFindings,
            HttpServletRequest request) throws IOException {
        ExternalFindingImporter importer = importers.stream()
                .filter(i -> i.supports(format))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "unsupported format '" + format + "', expected one of: semgrep, sarif"));

        int cap = Math.max(1, Math.min(maxFindings, MAX_FINDINGS_PER_REQUEST));
        List<ExternalFinding> findings = importer.importJson(request.getInputStream(), cap);

        GraphRagOptions defaults = GraphRagOptions.defaults();
        GraphRagOptions graphRag = new GraphRagOptions(
                defaults.seedLimit(), defaults.graphDepth(), defaults.callGraph(),
                defaults.impactExpansion(), defaults.rerank(), projectId,
                defaults.lang(), defaults.noTest());
        ContextPackOptions options = new ContextPackOptions(
                "security",
                Math.max(MIN_BUDGET_CHARS, Math.min(budgetChars, MAX_BUDGET_CHARS)),
                graphRag);

        List<TriageReport> reports = findings.stream()
                .map(finding -> findingContextService.build(finding, options))
                .map(triageReportService::build)
                .toList();

        ReportSnapshot snapshot = new ReportSnapshot(
                UUID.randomUUID().toString(),
                projectId,
                "1",
                buildProperties.getVersion(),
                codeVersion == null ? "" : codeVersion,
                ruleVersion == null ? "" : ruleVersion,
                Instant.now().toString(),
                reports);
        List<ReviewQueueEntry> entries = reviewQueueStore.submit(snapshot);
        return new SubmitSnapshotResponse(snapshot.id(), entries);
    }

    /**
     * 按条件筛选审核队列条目。
     *
     * @param projectId     项目 ID
     * @param severity      可选严重程度过滤
     * @param verdict       可选结论过滤
     * @param status        可选状态过滤
     * @param ruleId        可选规则标识过滤
     * @param updatedAfter  可选更新时间下界（ISO-8601，含）
     * @param updatedBefore 可选更新时间上界（ISO-8601，不含）
     * @return 按更新时间降序的条目列表
     */
    @GetMapping
    public List<ReviewQueueEntry> list(
            @RequestParam String projectId,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String verdict,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String ruleId,
            @RequestParam(required = false) String updatedAfter,
            @RequestParam(required = false) String updatedBefore) {
        return reviewQueueStore.list(
                projectId,
                parseEnum(severity, ExternalFindingSeverity::valueOf, "severity"),
                parseEnum(verdict, TriageVerdict::valueOf, "verdict"),
                parseEnum(status, ReviewStatus::valueOf, "status"),
                ruleId, updatedAfter, updatedBefore);
    }

    /**
     * 认领一条待审条目。
     *
     * @param entryId 条目标识
     * @param request 认领人
     * @return 认领结果
     */
    @PostMapping("/{entryId}/claim")
    public ResponseEntity<Map<String, String>> claim(
            @PathVariable String entryId, @RequestBody ClaimRequest request) {
        boolean claimed = reviewQueueStore.claim(entryId, request.actor(), Instant.now().toString());
        return respondTransition(entryId, claimed, "IN_REVIEW");
    }

    /**
     * 退回一条正在复核的条目。
     *
     * @param entryId 条目标识
     * @param request 操作人和退回理由
     * @return 退回结果
     */
    @PostMapping("/{entryId}/return")
    public ResponseEntity<Map<String, String>> returnToQueue(
            @PathVariable String entryId, @RequestBody ActionRequest request) {
        boolean returned = reviewQueueStore.returnToQueue(
                entryId, request.actor(), request.reason(), Instant.now().toString());
        return respondTransition(entryId, returned, "PENDING");
    }

    /**
     * 确认一条正在复核的条目为真实风险。
     *
     * @param entryId 条目标识
     * @param request 操作人和确认理由
     * @return 确认结果
     */
    @PostMapping("/{entryId}/confirm")
    public ResponseEntity<Map<String, String>> confirm(
            @PathVariable String entryId, @RequestBody ActionRequest request) {
        boolean confirmed = reviewQueueStore.confirm(
                entryId, request.actor(), request.reason(), Instant.now().toString());
        return respondTransition(entryId, confirmed, "CONFIRMED");
    }

    /**
     * 驳回一条正在复核的条目。
     *
     * @param entryId 条目标识
     * @param request 操作人和驳回理由
     * @return 驳回结果
     */
    @PostMapping("/{entryId}/reject")
    public ResponseEntity<Map<String, String>> reject(
            @PathVariable String entryId, @RequestBody ActionRequest request) {
        boolean rejected = reviewQueueStore.reject(
                entryId, request.actor(), request.reason(), Instant.now().toString());
        return respondTransition(entryId, rejected, "REJECTED");
    }

    /**
     * 查询队列条目的审计事件。
     *
     * @param entryId 条目标识
     * @return 审计事件列表
     */
    @GetMapping("/{entryId}/audit")
    public List<ReviewQueueAuditEvent> audit(@PathVariable String entryId) {
        return reviewQueueStore.audit(entryId);
    }

    /**
     * 导出一份报告快照。三种格式派生自同一份快照，保证 finding 数、结论与 citation 一致。
     *
     * @param snapshotId 快照标识
     * @param format     导出格式，支持 {@code markdown}、{@code json}、{@code pdf}
     * @return 渲染结果
     */
    @GetMapping("/snapshots/{snapshotId}/export")
    public ResponseEntity<byte[]> export(
            @PathVariable String snapshotId,
            @RequestParam String format) {
        ReportSnapshot snapshot = reviewQueueStore.getSnapshot(snapshotId)
                .orElseThrow(() -> new ReviewQueueEntryNotFoundException(
                        "report snapshot not found: " + snapshotId));
        return switch (format.trim().toLowerCase()) {
            case "markdown" -> ResponseEntity.ok()
                    .contentType(MediaType.TEXT_MARKDOWN)
                    .body(renderMarkdown(snapshot).getBytes(StandardCharsets.UTF_8));
            case "json" -> ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(writeJson(snapshot).getBytes(StandardCharsets.UTF_8));
            case "pdf" -> ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_PDF)
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename=\"report-" + snapshot.id() + ".pdf\"")
                    .body(reportPdfRenderer.render(renderMarkdown(snapshot)));
            default -> throw new IllegalArgumentException("Unsupported format: " + format);
        };
    }

    private String renderMarkdown(ReportSnapshot snapshot) {
        StringBuilder md = new StringBuilder();
        md.append("# 报告快照 `").append(snapshot.id()).append("`\n\n");
        md.append("- schemaVersion: ").append(snapshot.schemaVersion()).append('\n');
        md.append("- toolVersion: ").append(snapshot.toolVersion()).append('\n');
        md.append("- projectId: ").append(snapshot.projectId()).append('\n');
        md.append("- codeVersion: ").append(snapshot.codeVersion()).append('\n');
        md.append("- ruleVersion: ").append(snapshot.ruleVersion()).append('\n');
        md.append("- generatedAt: ").append(snapshot.generatedAt()).append("\n\n");
        md.append(triageReportService.toMarkdownSummary(snapshot.reports()));
        return md.toString();
    }

    private String writeJson(ReportSnapshot snapshot) {
        try {
            return objectMapper.writeValueAsString(snapshot);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize report snapshot '" + snapshot.id() + "'", e);
        }
    }

    private static ResponseEntity<Map<String, String>> respondTransition(
            String entryId, boolean succeeded, String newStatus) {
        if (!succeeded) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(Map.of("id", entryId, "status", newStatus));
    }

    private static <T extends Enum<T>> T parseEnum(
            String raw, Function<String, T> valueOf, String field) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return valueOf.apply(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid " + field + ": " + raw, e);
        }
    }

    /**
     * 快照提交响应。
     *
     * @param snapshotId 新生成的报告快照标识
     * @param entries    快照对应的待审条目
     */
    public record SubmitSnapshotResponse(String snapshotId, List<ReviewQueueEntry> entries) {}

    /**
     * 认领请求。
     *
     * @param actor 认领人
     */
    public record ClaimRequest(String actor) {}

    /**
     * 退回/确认/驳回共用的请求。
     *
     * @param actor  操作人
     * @param reason 操作理由
     */
    public record ActionRequest(String actor, String reason) {}
}
