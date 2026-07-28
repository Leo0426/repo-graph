package com.repograph.scanner;

import com.repograph.core.asset.AssetNotReadyException;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.scanner.ExternalScanBatchResult;
import com.repograph.core.scanner.ExternalScanOptions;
import com.repograph.core.scanner.ExternalScanService;
import com.repograph.core.scanner.ScanBatchStatus;
import com.repograph.core.scanner.ScannerAdapter;
import com.repograph.core.scanner.ScannerAvailability;
import com.repograph.core.scanner.ScannerRequest;
import com.repograph.core.scanner.ScannerRunResult;
import com.repograph.core.scanner.ScannerRunStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 外部扫描器同步编排默认实现，按扫描器隔离失败并持久化独立结果。
 *
 * @author leolu
 */
@Service
public class DefaultExternalScannerService implements ExternalScanService {

    private final Map<String, ScannerAdapter> adapters;
    private final ScannerRunStore runStore;
    private final ScannerProperties properties;

    /**
     * 创建外部扫描编排服务。
     *
     * @param adapters 已注册扫描器适配器
     * @param runStore 扫描运行存储
     * @param properties 扫描器配置
     */
    public DefaultExternalScannerService(
            List<ScannerAdapter> adapters,
            ScannerRunStore runStore,
            ScannerProperties properties) {
        this.adapters = indexAdapters(adapters);
        this.runStore = runStore;
        this.properties = properties;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<ScannerAvailability> capabilities() {
        return adapters.values().stream()
                .map(this::safeProbe)
                .sorted(Comparator.comparing(item -> item.capability().scanner()))
                .toList();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public ExternalScanBatchResult scan(ImportedAsset asset, ExternalScanOptions options) {
        if (asset.status() != AssetStatus.READY) {
            throw new AssetNotReadyException(
                    "Asset '" + asset.assetId() + "' is not ready: " + asset.status());
        }
        List<String> requested = options.scanners().stream().sorted().toList();
        List<String> unknown = requested.stream().filter(scanner -> !adapters.containsKey(scanner)).toList();
        if (!unknown.isEmpty()) {
            throw new IllegalArgumentException("Unknown external scanners: " + String.join(", ", unknown));
        }

        String batchId = UUID.randomUUID().toString();
        List<ScannerRunResult> results = new ArrayList<>();
        for (String scanner : requested) {
            String scanId = batchId + "-" + scanner.toLowerCase(Locale.ROOT);
            ScannerRequest request = new ScannerRequest(
                    scanId, asset.projectId(), asset.projectRoot(), options.languages(), options.timeoutSeconds());
            ScannerRunResult result = safeScan(adapters.get(scanner), request);
            runStore.save(batchId, result);
            results.add(result);
        }
        return new ExternalScanBatchResult(batchId, asset.projectId(), batchStatus(results), results);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public Optional<ScannerRunResult> findRun(String scanId) {
        return runStore.findRun(scanId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<ScannerRunResult> listRuns(String projectId) {
        return runStore.listRuns(projectId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<ExternalFinding> listFindings(String projectId) {
        return runStore.listFindings(projectId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void removeProject(String projectId) {
        List<String> batchIds = runStore.listBatchIds(projectId);
        batchIds.forEach(batchId -> ScannerWorkTree.deleteBatch(properties.workDir(), batchId));
        runStore.removeProject(projectId);
    }

    private ScannerAvailability safeProbe(ScannerAdapter adapter) {
        try {
            return adapter.probe();
        } catch (RuntimeException e) {
            return new ScannerAvailability(adapter.capability(), false, "", safeMessage(e));
        }
    }

    private ScannerRunResult safeScan(ScannerAdapter adapter, ScannerRequest request) {
        try {
            return adapter.scan(request);
        } catch (RuntimeException e) {
            String now = Instant.now().toString();
            return new ScannerRunResult(
                    request.scanId(),
                    request.projectId(),
                    adapter.capability().scanner(),
                    ScannerRunStatus.FAILED,
                    "",
                    -1,
                    0,
                    now,
                    now,
                    List.of(),
                    "adapter failed: " + safeMessage(e));
        }
    }

    private static ScanBatchStatus batchStatus(List<ScannerRunResult> results) {
        long succeeded = results.stream()
                .filter(result -> result.status() == ScannerRunStatus.SUCCEEDED
                        || result.status() == ScannerRunStatus.PARTIAL)
                .count();
        if (succeeded == results.size()) {
            return ScanBatchStatus.SUCCEEDED;
        }
        return succeeded == 0 ? ScanBatchStatus.FAILED : ScanBatchStatus.PARTIAL;
    }

    private static Map<String, ScannerAdapter> indexAdapters(List<ScannerAdapter> adapters) {
        Map<String, ScannerAdapter> indexed = new LinkedHashMap<>();
        for (ScannerAdapter adapter : adapters) {
            String scanner = adapter.capability().scanner().toUpperCase(Locale.ROOT);
            if (indexed.putIfAbsent(scanner, adapter) != null) {
                throw new IllegalStateException("Duplicate scanner adapter: " + scanner);
            }
        }
        return Map.copyOf(indexed);
    }

    private static String safeMessage(Exception exception) {
        return exception.getMessage() == null || exception.getMessage().isBlank()
                ? exception.getClass().getSimpleName()
                : exception.getMessage();
    }
}
