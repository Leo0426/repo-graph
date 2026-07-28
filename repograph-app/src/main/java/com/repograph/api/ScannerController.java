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
import com.repograph.core.scanner.ScannerAvailability;
import com.repograph.core.scanner.ScannerRunResult;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
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
    private final long defaultTimeoutSeconds;

    /**
     * 创建外部扫描器控制器。
     *
     * @param assetImportService 资产接入服务
     * @param assetProfileService 资产画像服务
     * @param externalScanService 外部扫描编排服务
     * @param defaultTimeoutSeconds 服务端扫描超时上限
     */
    public ScannerController(
            AssetImportService assetImportService,
            AssetProfileService assetProfileService,
            ExternalScanService externalScanService,
            @Value("${repograph.scanners.default-timeout-seconds}") long defaultTimeoutSeconds) {
        this.assetImportService = assetImportService;
        this.assetProfileService = assetProfileService;
        this.externalScanService = externalScanService;
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
}
