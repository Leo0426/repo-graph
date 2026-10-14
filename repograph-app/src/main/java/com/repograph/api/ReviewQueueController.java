package com.repograph.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.TriageOptions;
import com.repograph.core.finding.TriageWorkflow;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.ReportSnapshot;
import com.repograph.core.finding.ReviewQueueAuditEvent;
import com.repograph.core.finding.ReviewQueueEntry;
import com.repograph.core.finding.ReviewQueueEntryNotFoundException;
import com.repograph.core.finding.ReviewStatus;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
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

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * 审核队列 REST API：把批量研判结果固化为报告快照并生成待审条目，
 * 支持认领/退回/确认/驳回及 Markdown/JSON 导出。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/review-queue")
public class ReviewQueueController {


    private final TriageWorkflow workflow;
    private final TriageReportService triageReportService;
    private final ReviewQueueStore reviewQueueStore;
    private final BuildProperties buildProperties;
    private final ObjectMapper objectMapper;
    private final ReportPdfRenderer reportPdfRenderer;

    /**
     * 创建审核队列 REST 控制器。
     *
     * @param workflow             共享研判流程
     * @param triageReportService   研判报告生成服务
     * @param reviewQueueStore      审核队列及快照存储
     * @param buildProperties       应用构建信息，用于填充快照的工具版本
     * @param objectMapper          快照 JSON 导出使用的 Jackson mapper
     * @param reportPdfRenderer     报告 PDF 渲染器
     */
    public ReviewQueueController(
            TriageWorkflow workflow,
            TriageReportService triageReportService,
            ReviewQueueStore reviewQueueStore,
            BuildProperties buildProperties,
            ObjectMapper objectMapper,
            ReportPdfRenderer reportPdfRenderer) {
        this.workflow = workflow;
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
        TriageOptions options = new TriageOptions(projectId, codeVersion, ruleVersion, budgetChars);
        List<TriageReport> reports = workflow.importFindings(format, request.getInputStream(), maxFindings).stream()
                .map(finding -> workflow.buildContext(finding, options))
                .map(context -> workflow.review(context, options))
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
    public ReviewQueueListResponse list(
            @RequestParam String projectId,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String verdict,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String ruleId,
            @RequestParam(required = false) String updatedAfter,
            @RequestParam(required = false) String updatedBefore,
            @RequestParam(required = false, defaultValue = "0") Integer page,
            @RequestParam(required = false, defaultValue = "100") Integer size) {
        int safePage = Math.max(page, 0);
        int safeSize = size == null || size <= 0 ? 100 : Math.min(size, 500);
        ExternalFindingSeverity severityFilter =
                parseEnum(severity, ExternalFindingSeverity::valueOf, "severity");
        TriageVerdict verdictFilter = parseEnum(verdict, TriageVerdict::valueOf, "verdict");
        ReviewStatus statusFilter = parseEnum(status, ReviewStatus::valueOf, "status");
        List<ReviewQueueEntry> entries = reviewQueueStore.list(
                projectId,
                severityFilter,
                verdictFilter,
                statusFilter,
                ruleId, updatedAfter, updatedBefore,
                safePage * safeSize, safeSize);
        long total = reviewQueueStore.count(
                projectId, severityFilter, verdictFilter, statusFilter,
                ruleId, updatedAfter, updatedBefore);
        return new ReviewQueueListResponse(entries, safePage, safeSize, total);
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

    /**
     * 批量导出多份报告快照为 ZIP 包：每份快照复用单快照导出的同源渲染路径，
     * 附 manifest.json 记录每个请求 id 的导出状态；部分缺失正常返回并在 manifest
     * 标记，全部缺失返回 404。单快照渲染失败不中断整包。
     *
     * @param request 批量导出请求：快照 ID 列表 + 目标格式
     * @return ZIP 字节流（manifest.json + 各快照导出文件）
     */
    @PostMapping("/snapshots/export-batch")
    public ResponseEntity<byte[]> exportBatch(@RequestBody BatchExportRequest request) {
        List<String> snapshotIds = request.snapshotIds() == null
                ? List.of()
                : request.snapshotIds().stream()
                        .filter(id -> id != null && !id.isBlank())
                        .distinct()
                        .toList();
        if (snapshotIds.isEmpty()) {
            throw new IllegalArgumentException("snapshotIds must not be empty");
        }
        if (snapshotIds.size() > 100) {
            throw new IllegalArgumentException("snapshotIds must not exceed 100");
        }
        String format = request.format() == null ? "" : request.format().trim().toLowerCase();
        if (!List.of("markdown", "json", "pdf").contains(format)) {
            throw new IllegalArgumentException("Unsupported format: " + request.format());
        }

        List<BatchManifestEntry> manifest = new ArrayList<>();
        Map<String, byte[]> files = new LinkedHashMap<>();
        int exported = 0;
        for (String snapshotId : snapshotIds) {
            try {
                ReportSnapshot snapshot = reviewQueueStore.getSnapshot(snapshotId)
                        .orElseThrow(() -> new ReviewQueueEntryNotFoundException(
                                "report snapshot not found: " + snapshotId));
                String fileName = "snapshots/" + snapshotId + "/report." + extensionOf(format);
                files.put(fileName, renderForFormat(snapshot, format));
                manifest.add(new BatchManifestEntry(snapshotId, "exported", fileName, ""));
                exported++;
            } catch (ReviewQueueEntryNotFoundException e) {
                manifest.add(new BatchManifestEntry(snapshotId, "missing", "", e.getMessage()));
            } catch (Exception e) {
                manifest.add(new BatchManifestEntry(snapshotId, "missing", "",
                        "render failed: " + e.getMessage()));
            }
        }
        if (exported == 0) {
            throw new ReviewQueueEntryNotFoundException(
                    "none of the requested snapshots could be exported");
        }
        byte[] zip = buildZip(files, manifest);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/zip"))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"snapshots-export.zip\"")
                .body(zip);
    }

    private static String extensionOf(String format) {
        return switch (format) {
            case "markdown" -> "md";
            case "json" -> "json";
            default -> "pdf";
        };
    }

    private byte[] renderForFormat(ReportSnapshot snapshot, String format) {
        return switch (format) {
            case "markdown" -> renderMarkdown(snapshot).getBytes(StandardCharsets.UTF_8);
            case "json" -> writeJson(snapshot).getBytes(StandardCharsets.UTF_8);
            default -> reportPdfRenderer.render(renderMarkdown(snapshot));
        };
    }

    private byte[] buildZip(Map<String, byte[]> files, List<BatchManifestEntry> manifest) {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream();
             ZipOutputStream zip = new ZipOutputStream(out)) {
            zip.putNextEntry(new ZipEntry("manifest.json"));
            zip.write(writeJson(manifest).getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            for (Map.Entry<String, byte[]> file : files.entrySet()) {
                zip.putNextEntry(new ZipEntry(file.getKey()));
                zip.write(file.getValue());
                zip.closeEntry();
            }
            zip.finish();
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to build snapshot export zip", e);
        }
    }

    /** 批量导出请求：快照 ID 列表与目标格式。 */
    public record BatchExportRequest(List<String> snapshotIds, String format) {}

    /** 批量导出 manifest 条目：单份快照的导出状态与文件位置。 */
    public record BatchManifestEntry(String snapshotId, String status, String file, String reason) {}

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

    private String writeJson(List<BatchManifestEntry> manifest) {
        try {
            return objectMapper.writeValueAsString(manifest);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize export manifest", e);
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
    /** 列表分页信封：当前页条目 + 分页参数 + 同过滤条件下的总数。 */
    public record ReviewQueueListResponse(
            List<ReviewQueueEntry> entries, int page, int size, long total) {}

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
