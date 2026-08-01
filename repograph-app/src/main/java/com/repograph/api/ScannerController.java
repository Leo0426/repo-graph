package com.repograph.api;

import com.repograph.core.asset.AssetImportService;
import com.repograph.core.asset.AssetProfileOptions;
import com.repograph.core.asset.AssetProfileService;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.asset.ProjectAssetProfile;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.scanner.ExternalScanBatchResult;
import com.repograph.core.scanner.ExternalScanOptions;
import com.repograph.core.scanner.ExternalScanService;
import com.repograph.core.scanner.ScanTask;
import com.repograph.core.scanner.ScanTaskFindingsPage;
import com.repograph.core.scanner.ScanTaskService;
import com.repograph.core.scanner.ScannerAvailability;
import com.repograph.core.scanner.ScannerRunResult;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 外部扫描器能力探测、执行和结果查询 REST API。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1")
public class ScannerController {

    private static final Set<String> IMPLEMENTED_EXTERNAL_SCANNERS = Set.of("SEMGREP", "CODEQL");

    private final AssetImportService assetImportService;
    private final AssetProfileService assetProfileService;
    private final ExternalScanService externalScanService;
    private final ScanTaskService scanTaskService;
    private final long defaultTimeoutSeconds;

    /**
     * 创建外部扫描器控制器。
     *
     * @param assetImportService 资产接入服务
     * @param assetProfileService 资产画像服务
     * @param externalScanService 外部扫描编排服务
     * @param scanTaskService 异步扫描任务编排服务
     * @param defaultTimeoutSeconds 服务端扫描超时上限
     */
    public ScannerController(
            AssetImportService assetImportService,
            AssetProfileService assetProfileService,
            ExternalScanService externalScanService,
            ScanTaskService scanTaskService,
            @Value("${repograph.scanners.default-timeout-seconds}") long defaultTimeoutSeconds) {
        this.assetImportService = assetImportService;
        this.assetProfileService = assetProfileService;
        this.externalScanService = externalScanService;
        this.scanTaskService = scanTaskService;
        this.defaultTimeoutSeconds = defaultTimeoutSeconds;
    }

    /**
     * 探测已注册外部扫描器的命令和版本。
     *
     * @return 扫描器能力与当前可用性
     */
    @GetMapping("/scanners/capabilities")
    public List<ScannerAvailability> capabilities() {
        return externalScanService.capabilities();
    }

    /**
     * 对一个已就绪资产同步执行所选外部扫描器。
     *
     * <p>请求未指定扫描器时使用资产画像中已选择且当前已实现的外部扫描器。
     *
     * @param assetId 资产标识
     * @param request 可选扫描器和超时覆盖
     * @return 批次执行结果；资产不存在时 404
     */
    @PostMapping("/assets/{assetId}/scans")
    public ResponseEntity<ExternalScanBatchResult> scan(
            @PathVariable String assetId,
            @RequestBody(required = false) StartScanRequest request) {
        Optional<ImportedAsset> found = assetImportService.find(assetId);
        if (found.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        ImportedAsset asset = found.get();
        ProjectAssetProfile profile = assetProfileService.build(asset, AssetProfileOptions.defaults());
        Set<String> scanners = requestedScanners(request, profile);
        long timeout = requestedTimeout(request);
        ExternalScanOptions options = new ExternalScanOptions(
                scanners,
                profile.languageDistribution().keySet().stream().toList(),
                timeout);
        return ResponseEntity.ok(externalScanService.scan(asset, options));
    }

    /**
     * 对一个已就绪资产提交一次异步扫描任务，立即返回 {@code 202} 与 {@code QUEUED} 任务标识，
     * 不阻塞等待扫描完成。用 {@code GET /scan-tasks/{taskId}} 轮询状态。
     *
     * @param assetId 资产标识
     * @param request 可选扫描器和超时覆盖
     * @return 任务标识与初始状态；资产不存在时 404
     */
    @PostMapping("/assets/{assetId}/scan-tasks")
    public ResponseEntity<SubmitScanTaskResponse> submitScanTask(
            @PathVariable String assetId,
            @RequestBody(required = false) StartScanRequest request) {
        Optional<ImportedAsset> found = assetImportService.find(assetId);
        if (found.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        ImportedAsset asset = found.get();
        ProjectAssetProfile profile = assetProfileService.build(asset, AssetProfileOptions.defaults());
        ExternalScanOptions options = new ExternalScanOptions(
                requestedScanners(request, profile),
                profile.languageDistribution().keySet().stream().toList(),
                requestedTimeout(request));
        ScanTask task = scanTaskService.submit(asset, options);
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(new SubmitScanTaskResponse(task.id(), task.status().name()));
    }

    /**
     * 查询异步扫描任务状态，含各扫描器运行状态与失败原因。
     *
     * @param taskId 任务标识
     * @return 任务状态；不存在时 404
     */
    @GetMapping("/scan-tasks/{taskId}")
    public ResponseEntity<ScanTaskStatusResponse> scanTaskStatus(@PathVariable String taskId) {
        Optional<ScanTask> found = scanTaskService.find(taskId);
        if (found.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        ScanTask task = found.get();
        List<ScannerRunSummary> scanners = scanTaskService.result(taskId)
                .map(batch -> batch.runs().stream()
                        .map(run -> new ScannerRunSummary(
                                run.scanner(), run.status().name(), run.exitCode(), run.error()))
                        .toList())
                .orElseGet(List::of);
        return ResponseEntity.ok(new ScanTaskStatusResponse(
                task.id(), task.projectId(), task.status().name(),
                task.attempt(), task.error(), scanners));
    }

    /**
     * 分页查询异步扫描任务去重后的归一化报警。
     *
     * @param taskId 任务标识
     * @param page   页码，从 0 起
     * @param size   每页大小，服务端限制为 1–200
     * @return 一页报警；任务不存在时 404
     */
    @GetMapping("/scan-tasks/{taskId}/findings")
    public ResponseEntity<ScanTaskFindingsPage> scanTaskFindings(
            @PathVariable String taskId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        if (scanTaskService.find(taskId).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        int safeSize = Math.max(1, Math.min(size, 200));
        return ResponseEntity.ok(scanTaskService.findings(taskId, Math.max(0, page), safeSize));
    }

    /**
     * 查询一个资产的扫描运行历史。
     *
     * @param assetId 资产标识
     * @return 扫描历史；资产不存在时 404
     */
    @GetMapping("/assets/{assetId}/scans")
    public ResponseEntity<List<ScannerRunResult>> listRuns(@PathVariable String assetId) {
        return assetImportService.find(assetId)
                .map(asset -> ResponseEntity.ok(externalScanService.listRuns(asset.projectId())))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * 查询单个扫描运行。
     *
     * @param scanId 扫描运行标识
     * @return 扫描运行；不存在时 404
     */
    @GetMapping("/scans/{scanId}")
    public ResponseEntity<ScannerRunResult> findRun(@PathVariable String scanId) {
        return externalScanService.findRun(scanId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * 查询资产按指纹去重后的外部报警。
     *
     * @param assetId 资产标识
     * @return 外部报警；资产不存在时 404
     */
    @GetMapping("/assets/{assetId}/external-findings")
    public ResponseEntity<List<ExternalFinding>> listFindings(@PathVariable String assetId) {
        return assetImportService.find(assetId)
                .map(asset -> ResponseEntity.ok(externalScanService.listFindings(asset.projectId())))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    private Set<String> requestedScanners(
            StartScanRequest request,
            ProjectAssetProfile profile) {
        if (request != null && request.scanners() != null && !request.scanners().isEmpty()) {
            return new LinkedHashSet<>(request.scanners());
        }
        Set<String> recommended = new LinkedHashSet<>();
        profile.scannerPlan().stream()
                .filter(item -> item.selected() && IMPLEMENTED_EXTERNAL_SCANNERS.contains(item.scanner()))
                .map(item -> item.scanner())
                .forEach(recommended::add);
        if (recommended.isEmpty()) {
            throw new IllegalArgumentException("Asset profile has no applicable Semgrep or CodeQL scanner");
        }
        return recommended;
    }

    private long requestedTimeout(StartScanRequest request) {
        if (request == null || request.timeoutSeconds() == null) {
            return defaultTimeoutSeconds;
        }
        if (request.timeoutSeconds() < 1) {
            throw new IllegalArgumentException("timeoutSeconds must be greater than zero");
        }
        return Math.min(request.timeoutSeconds(), defaultTimeoutSeconds);
    }

    /**
     * 外部扫描启动请求。
     *
     * @param scanners       可选扫描器列表；为空时使用资产画像推荐
     * @param timeoutSeconds 可选超时；不能超过服务端配置上限
     */
    public record StartScanRequest(
            List<String> scanners,
            Long timeoutSeconds
    ) {}

    /**
     * 异步扫描任务提交响应。
     *
     * @param taskId 新建任务标识
     * @param status 初始状态（{@code QUEUED}）
     */
    public record SubmitScanTaskResponse(String taskId, String status) {}

    /**
     * 异步扫描任务状态响应。
     *
     * @param taskId    任务标识
     * @param projectId 项目标识
     * @param status    任务状态
     * @param attempt   执行次数
     * @param error     任务级失败原因
     * @param scanners  各扫描器运行摘要
     */
    public record ScanTaskStatusResponse(
            String taskId,
            String projectId,
            String status,
            int attempt,
            String error,
            List<ScannerRunSummary> scanners
    ) {}

    /**
     * 单个扫描器运行摘要（不含报警明细）。
     *
     * @param scanner  扫描器标识
     * @param status   运行状态
     * @param exitCode 进程退出码
     * @param error    结构化失败原因
     */
    public record ScannerRunSummary(String scanner, String status, int exitCode, String error) {}
}
