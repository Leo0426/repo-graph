package com.repograph.scanner;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.asset.AssetImportService;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.scanner.ExternalScanBatchResult;
import com.repograph.core.scanner.ExternalScanOptions;
import com.repograph.core.scanner.ExternalScanService;
import com.repograph.core.scanner.ScanBatchStatus;
import com.repograph.core.scanner.ScanTask;
import com.repograph.core.scanner.ScanTaskNotFoundException;
import com.repograph.core.scanner.ScanTaskStatus;
import com.repograph.core.scanner.ScannerRunResult;
import com.repograph.core.scanner.ScannerRunStatus;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link DefaultScanTaskService} 提交与执行行为测试，使用真实 SQLite 存储 + 同步 executor。
 *
 * @author leolu
 */
class DefaultScanTaskServiceTest {

    @TempDir
    Path tempDir;

    private ScanTaskStore store;
    private ExternalScanService externalScanService;
    private AssetImportService assetImportService;
    private DefaultScanTaskService service;

    /** 同步 executor：使 submit 内联执行 runTask，便于确定性断言。 */
    private static final Executor DIRECT = Runnable::run;

    @BeforeEach
    void setUp() {
        store = new ScanTaskStore(tempDir.resolve("tasks.db").toString(), new ObjectMapper());
        externalScanService = mock(ExternalScanService.class);
        assetImportService = mock(AssetImportService.class);
        // 高配额 + 同步 executor：调度不成为瓶颈，submit 内联执行以便确定性断言。
        ScanTaskScheduler scheduler = new ScanTaskScheduler(DIRECT, 100, 100, 100);
        service = new DefaultScanTaskService(store, externalScanService, assetImportService, scheduler);
    }

    @Test
    void submitCreatesQueuedThenRunsToTerminalStatus() {
        ImportedAsset asset = asset("asset-1", "p1");
        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset));
        when(externalScanService.scan(any(), any())).thenReturn(new ExternalScanBatchResult(
                "batch-1", "p1", ScanBatchStatus.PARTIAL,
                List.of(scannerRun("SEMGREP", ScannerRunStatus.SUCCEEDED, List.of()),
                        scannerRun("CODEQL", ScannerRunStatus.FAILED, List.of()))));

        ScanTask submitted = service.submit(asset, options());

        assertThat(submitted.status()).isEqualTo(ScanTaskStatus.QUEUED);
        ScanTask stored = store.find(submitted.id()).orElseThrow();
        assertThat(stored.status()).isEqualTo(ScanTaskStatus.PARTIAL);
        assertThat(stored.batchId()).isEqualTo("batch-1");
        verify(externalScanService).scan(any(), any());
    }

    @Test
    void runTaskFailsWhenAssetMissing() {
        ImportedAsset asset = asset("asset-gone", "p1");
        store.create(new ScanTask("t1", "p1", "asset-gone",
                List.of("SEMGREP"), List.of("java"), 300,
                ScanTaskStatus.QUEUED, 1, "", "", now(), now()));
        when(assetImportService.find("asset-gone")).thenReturn(Optional.empty());

        service.runTask("t1");

        ScanTask failed = store.find("t1").orElseThrow();
        assertThat(failed.status()).isEqualTo(ScanTaskStatus.FAILED);
        assertThat(failed.error()).contains("asset not found");
    }

    @Test
    void runTaskFailsWhenScanThrows() {
        ImportedAsset asset = asset("asset-1", "p1");
        store.create(new ScanTask("t1", "p1", "asset-1",
                List.of("SEMGREP"), List.of("java"), 300,
                ScanTaskStatus.QUEUED, 1, "", "", now(), now()));
        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset));
        when(externalScanService.scan(any(), any()))
                .thenThrow(new IllegalStateException("engine boom"));

        service.runTask("t1");

        ScanTask failed = store.find("t1").orElseThrow();
        assertThat(failed.status()).isEqualTo(ScanTaskStatus.FAILED);
        assertThat(failed.error()).contains("engine boom");
    }

    @Test
    void cancelQueuedTaskPreventsExecution() {
        store.create(new ScanTask("t1", "p1", "asset-1",
                List.of("SEMGREP"), List.of("java"), 300,
                ScanTaskStatus.QUEUED, 1, "", "", now(), now()));

        ScanTask cancelled = service.cancel("t1");
        assertThat(cancelled.status()).isEqualTo(ScanTaskStatus.CANCELLED);

        // 取消后再执行：markRunning 失败，扫描器永不被调用。
        service.runTask("t1");
        assertThat(store.find("t1").orElseThrow().status()).isEqualTo(ScanTaskStatus.CANCELLED);
        verifyNoInteractions(externalScanService);
    }

    @Test
    void cancelRunningTaskInterruptsWorkerAndStaysCancelled() throws Exception {
        ImportedAsset asset = asset("asset-1", "p1");
        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset));
        store.create(new ScanTask("t1", "p1", "asset-1",
                List.of("SEMGREP"), List.of("java"), 300,
                ScanTaskStatus.QUEUED, 1, "", "", now(), now()));

        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch interrupted = new CountDownLatch(1);
        when(externalScanService.scan(any(), any())).thenAnswer(inv -> {
            started.countDown();
            try {
                Thread.sleep(30_000);
            } catch (InterruptedException e) {
                interrupted.countDown();
                Thread.currentThread().interrupt();
                throw new IllegalStateException("scan interrupted");
            }
            return new ExternalScanBatchResult("b", "p1", ScanBatchStatus.SUCCEEDED, List.of());
        });

        Thread worker = new Thread(() -> service.runTask("t1"), "test-scan-worker");
        worker.start();

        assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
        ScanTask cancelled = service.cancel("t1");
        assertThat(cancelled.status()).isEqualTo(ScanTaskStatus.CANCELLED);
        assertThat(interrupted.await(5, TimeUnit.SECONDS)).isTrue();

        worker.join(5_000);
        assertThat(store.find("t1").orElseThrow().status()).isEqualTo(ScanTaskStatus.CANCELLED);
    }

    @Test
    void retryRerunsOnlyFailedScannersAndDeduplicatesFindings() {
        // 造一个 PARTIAL 完成态：SEMGREP 成功（1 报警），CODEQL 失败。
        store.create(new ScanTask("t1", "p1", "asset-1",
                List.of("SEMGREP", "CODEQL"), List.of("java"), 300,
                ScanTaskStatus.QUEUED, 1, "", "", now(), now()));
        store.markRunning("t1", now());
        ExternalFinding fa = finding("SEMGREP", "rule-a", "A.java", 10);
        store.complete("t1", new ExternalScanBatchResult("b1", "p1", ScanBatchStatus.PARTIAL,
                        List.of(scannerRun("SEMGREP", ScannerRunStatus.SUCCEEDED, List.of(fa)),
                                scannerRun("CODEQL", ScannerRunStatus.FAILED, List.of()))),
                ScanTaskStatus.PARTIAL, now());

        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset("asset-1", "p1")));
        ExternalFinding fb = finding("CODEQL", "rule-b", "B.java", 20);
        // 重试时只应重跑 CODEQL；返回含重复报警以验证去重。
        when(externalScanService.scan(any(), any())).thenReturn(new ExternalScanBatchResult(
                "b2", "p1", ScanBatchStatus.SUCCEEDED,
                List.of(scannerRun("CODEQL", ScannerRunStatus.SUCCEEDED, List.of(fb, fb)))));

        ScanTask retried = service.retry("t1");
        assertThat(retried.attempt()).isEqualTo(2);

        ScanTask done = store.find("t1").orElseThrow();
        assertThat(done.status()).isEqualTo(ScanTaskStatus.SUCCEEDED);
        // 合并保留的 SEMGREP + 重跑的 CODEQL，去重后 2 条。
        assertThat(store.findingsPage("t1", 0, 50).total()).isEqualTo(2);

        // 只重跑未成功的 CODEQL，已成功的 SEMGREP 跳过。
        ArgumentCaptor<ExternalScanOptions> options = ArgumentCaptor.forClass(ExternalScanOptions.class);
        verify(externalScanService).scan(any(), options.capture());
        assertThat(options.getValue().scanners()).containsExactly("CODEQL");
    }

    @Test
    void retryRejectsNonRetryableStatus() {
        store.create(new ScanTask("t1", "p1", "asset-1",
                List.of("SEMGREP"), List.of("java"), 300,
                ScanTaskStatus.QUEUED, 1, "", "", now(), now()));

        assertThatThrownBy(() -> service.retry("t1"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void retryThrowsForUnknownTask() {
        assertThatThrownBy(() -> service.retry("nope"))
                .isInstanceOf(ScanTaskNotFoundException.class);
    }

    @Test
    void cancelThrowsForUnknownTask() {
        assertThatThrownBy(() -> service.cancel("nope"))
                .isInstanceOf(ScanTaskNotFoundException.class);
    }

    @Test
    void findingsThrowsForUnknownTask() {
        assertThatThrownBy(() -> service.findings("nope", 0, 10))
                .isInstanceOf(ScanTaskNotFoundException.class);
    }

    private static ExternalScanOptions options() {
        return new ExternalScanOptions(Set.of("SEMGREP", "CODEQL"), List.of("java"), 300);
    }

    private static ImportedAsset asset(String assetId, String projectId) {
        return new ImportedAsset(assetId, projectId, "a.zip", "zip",
                null, AssetStatus.READY, "", now(), now(), null);
    }

    private static ScannerRunResult scannerRun(
            String scanner, ScannerRunStatus status, List<ExternalFinding> findings) {
        return new ScannerRunResult("scan-" + scanner, "p1", scanner, status, "1.0", 0, 5,
                now(), now(), findings, status == ScannerRunStatus.FAILED ? "boom" : "");
    }

    private static ExternalFinding finding(String tool, String ruleId, String file, int line) {
        return new ExternalFinding(tool, ruleId, "CWE-79", ExternalFindingSeverity.MEDIUM,
                "msg", file, line, line, "sym", List.of(), "{}");
    }

    private static String now() {
        return "2026-08-01T00:00:00Z";
    }
}
