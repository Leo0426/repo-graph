package com.repograph.scanner;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.scanner.ExternalScanBatchResult;
import com.repograph.core.scanner.ScanBatchStatus;
import com.repograph.core.scanner.ScanTask;
import com.repograph.core.scanner.ScanTaskFindingsPage;
import com.repograph.core.scanner.ScanTaskStatus;
import com.repograph.core.scanner.ScannerRunResult;
import com.repograph.core.scanner.ScannerRunStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link ScanTaskStore} 异步扫描任务持久化与状态机测试，使用临时 SQLite 文件。
 *
 * @author leolu
 */
class ScanTaskStoreTest {

    @TempDir
    Path tempDir;

    private ScanTaskStore store;

    @BeforeEach
    void setUp() {
        store = new ScanTaskStore(tempDir.resolve("tasks.db").toString(), new ObjectMapper());
    }

    @Test
    void createPersistsQueuedTask() {
        ScanTask task = queued("t1", "p1");
        store.create(task);

        Optional<ScanTask> found = store.find("t1");
        assertThat(found).isPresent();
        assertThat(found.get().status()).isEqualTo(ScanTaskStatus.QUEUED);
        assertThat(found.get().attempt()).isEqualTo(1);
        assertThat(found.get().scanners()).containsExactly("SEMGREP", "CODEQL");
    }

    @Test
    void markRunningOnlyFromQueued() {
        store.create(queued("t1", "p1"));

        assertThat(store.markRunning("t1", "2026-08-01T00:00:01Z")).isTrue();
        assertThat(store.find("t1").orElseThrow().status()).isEqualTo(ScanTaskStatus.RUNNING);
        // 再次标记应为 no-op（已不在 QUEUED）
        assertThat(store.markRunning("t1", "2026-08-01T00:00:02Z")).isFalse();
    }

    @Test
    void completeStoresBatchAndTerminalStatus() {
        store.create(queued("t1", "p1"));
        store.markRunning("t1", "2026-08-01T00:00:01Z");

        ExternalScanBatchResult batch = new ExternalScanBatchResult(
                "batch-1", "p1", ScanBatchStatus.PARTIAL,
                List.of(
                        run("s-ok", "p1", "SEMGREP", ScannerRunStatus.SUCCEEDED,
                                List.of(finding("SEMGREP", "rule-a", "A.java", 10))),
                        run("s-bad", "p1", "CODEQL", ScannerRunStatus.FAILED, List.of())));

        assertThat(store.complete("t1", batch, ScanTaskStatus.PARTIAL, "2026-08-01T00:00:09Z"))
                .isTrue();

        ScanTask done = store.find("t1").orElseThrow();
        assertThat(done.status()).isEqualTo(ScanTaskStatus.PARTIAL);
        assertThat(done.batchId()).isEqualTo("batch-1");

        Optional<ExternalScanBatchResult> result = store.result("t1");
        assertThat(result).isPresent();
        assertThat(result.get().runs()).hasSize(2);
        assertThat(result.get().runs().get(1).status()).isEqualTo(ScannerRunStatus.FAILED);
    }

    @Test
    void completeOnlyFromRunning() {
        store.create(queued("t1", "p1"));
        ExternalScanBatchResult batch = new ExternalScanBatchResult(
                "batch-1", "p1", ScanBatchStatus.SUCCEEDED, List.of());
        // 仍在 QUEUED，未 markRunning，不应生效
        assertThat(store.complete("t1", batch, ScanTaskStatus.SUCCEEDED, "2026-08-01T00:00:09Z"))
                .isFalse();
        assertThat(store.find("t1").orElseThrow().status()).isEqualTo(ScanTaskStatus.QUEUED);
    }

    @Test
    void failStoresErrorFromRunning() {
        store.create(queued("t1", "p1"));
        store.markRunning("t1", "2026-08-01T00:00:01Z");

        assertThat(store.fail("t1", "engine crashed: boom", "2026-08-01T00:00:05Z")).isTrue();
        ScanTask failed = store.find("t1").orElseThrow();
        assertThat(failed.status()).isEqualTo(ScanTaskStatus.FAILED);
        assertThat(failed.error()).contains("boom");
    }

    @Test
    void findingsPageDeduplicatesAndPaginates() {
        store.create(queued("t1", "p1"));
        store.markRunning("t1", "2026-08-01T00:00:01Z");
        ExternalFinding dup = finding("SEMGREP", "rule-a", "A.java", 10);
        ExternalScanBatchResult batch = new ExternalScanBatchResult(
                "batch-1", "p1", ScanBatchStatus.SUCCEEDED,
                List.of(
                        run("s1", "p1", "SEMGREP", ScannerRunStatus.SUCCEEDED,
                                List.of(dup,
                                        finding("SEMGREP", "rule-b", "B.java", 20),
                                        finding("SEMGREP", "rule-c", "C.java", 30))),
                        // 同一指纹在另一扫描器重复出现，应被去重
                        run("s2", "p1", "CODEQL", ScannerRunStatus.SUCCEEDED, List.of(dup))));
        store.complete("t1", batch, ScanTaskStatus.SUCCEEDED, "2026-08-01T00:00:09Z");

        ScanTaskFindingsPage page0 = store.findingsPage("t1", 0, 2);
        assertThat(page0.total()).isEqualTo(3);
        assertThat(page0.findings()).hasSize(2);

        ScanTaskFindingsPage page1 = store.findingsPage("t1", 1, 2);
        assertThat(page1.findings()).hasSize(1);
    }

    private static ScanTask queued(String id, String projectId) {
        return new ScanTask(id, projectId, "asset-" + projectId,
                List.of("SEMGREP", "CODEQL"), List.of("java"), 300,
                ScanTaskStatus.QUEUED, 1, "", "",
                "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
    }

    private static ScannerRunResult run(String scanId, String projectId, String scanner,
                                        ScannerRunStatus status, List<ExternalFinding> findings) {
        return new ScannerRunResult(scanId, projectId, scanner, status, "1.0", 0, 5,
                "2026-08-01T00:00:01Z", "2026-08-01T00:00:06Z", findings,
                status == ScannerRunStatus.FAILED ? "exit 2: boom" : "");
    }

    private static ExternalFinding finding(String tool, String ruleId, String file, int line) {
        return new ExternalFinding(tool, ruleId, "CWE-79", ExternalFindingSeverity.MEDIUM,
                "msg", file, line, line, "sym", List.of(), "{}");
    }
}
