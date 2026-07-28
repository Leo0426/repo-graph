package com.repograph.scanner;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.scanner.ExternalScanBatchResult;
import com.repograph.core.scanner.ExternalScanOptions;
import com.repograph.core.scanner.ExternalScanService;
import com.repograph.core.scanner.ScanBatchStatus;
import com.repograph.core.scanner.ScannerAdapter;
import com.repograph.core.scanner.ScannerAvailability;
import com.repograph.core.scanner.ScannerCapability;
import com.repograph.core.scanner.ScannerRequest;
import com.repograph.core.scanner.ScannerRunResult;
import com.repograph.core.scanner.ScannerRunStatus;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link DefaultExternalScannerService} 编排与持久化行为测试。
 *
 * @author leolu
 */
class DefaultExternalScannerServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void scan_isolatesAdapterFailureAndPersistsIdempotentFindingsAcrossRestart() throws Exception {
        Path projectRoot = Files.createDirectory(tempDir.resolve("project"));
        Path database = tempDir.resolve("index.db");
        ObjectMapper mapper = new ObjectMapper();
        ScannerRunStore firstStore = new ScannerRunStore(database.toString(), mapper);
        ScannerProperties properties = new ScannerProperties(
                tempDir.resolve("scan-work"), 5, 10, 10,
                "semgrep", "auto", "codeql", "security-extended");
        ExternalScanService service = new DefaultExternalScannerService(
                List.of(successAdapter(), throwingAdapter()), firstStore, properties);
        ImportedAsset asset = asset(projectRoot);
        ExternalScanOptions options = new ExternalScanOptions(
                Set.of("SEMGREP", "CODEQL"), List.of("java"), 5);

        ExternalScanBatchResult first = service.scan(asset, options);
        ExternalScanBatchResult repeated = service.scan(asset, options);

        assertThat(first.status()).isEqualTo(ScanBatchStatus.PARTIAL);
        assertThat(first.runs()).extracting(ScannerRunResult::status)
                .containsExactlyInAnyOrder(ScannerRunStatus.SUCCEEDED, ScannerRunStatus.FAILED);
        assertThat(repeated.runs()).hasSize(2);

        ScannerRunStore reopened = new ScannerRunStore(database.toString(), mapper);
        assertThat(reopened.listRuns("project-1")).hasSize(4);
        assertThat(reopened.listFindings("project-1")).singleElement()
                .satisfies(finding -> assertThat(finding.fingerprint()).isEqualTo(finding().fingerprint()));

        Path unrelated = Files.createDirectories(properties.workDir().resolve("keep"));
        Files.createDirectories(properties.workDir().resolve(first.batchId()).resolve("semgrep"));
        Files.createDirectories(properties.workDir().resolve(repeated.batchId()).resolve("codeql"));
        service.removeProject("project-1");

        assertThat(properties.workDir().resolve(first.batchId())).doesNotExist();
        assertThat(properties.workDir().resolve(repeated.batchId())).doesNotExist();
        assertThat(unrelated).isDirectory();
        assertThat(reopened.listRuns("project-1")).isEmpty();
        assertThat(reopened.listFindings("project-1")).isEmpty();
    }

    private ScannerAdapter successAdapter() {
        return new ScannerAdapter() {
            @Override
            public ScannerCapability capability() {
                return DefaultExternalScannerServiceTest.capability("SEMGREP");
            }

            @Override
            public ScannerAvailability probe() {
                return new ScannerAvailability(capability(), true, "1.0", "");
            }

            @Override
            public ScannerRunResult scan(ScannerRequest request) {
                String now = Instant.now().toString();
                return new ScannerRunResult(
                        request.scanId(), request.projectId(), "SEMGREP", ScannerRunStatus.SUCCEEDED,
                        "1.0", 0, 1, now, now, List.of(finding()), "");
            }
        };
    }

    private ScannerAdapter throwingAdapter() {
        return new ScannerAdapter() {
            @Override
            public ScannerCapability capability() {
                return DefaultExternalScannerServiceTest.capability("CODEQL");
            }

            @Override
            public ScannerAvailability probe() {
                return new ScannerAvailability(capability(), true, "2.0", "");
            }

            @Override
            public ScannerRunResult scan(ScannerRequest request) {
                throw new IllegalStateException("simulated adapter crash");
            }
        };
    }

    private static ScannerCapability capability(String scanner) {
        return new ScannerCapability(scanner, List.of("java"), scanner.toLowerCase(), "json", List.of());
    }

    private static ExternalFinding finding() {
        return new ExternalFinding(
                "semgrep", "java.command-injection", "CWE-78", ExternalFindingSeverity.HIGH,
                "command injection", "src/App.java", 3, 3, "run", List.of(), "{}");
    }

    private static ImportedAsset asset(Path projectRoot) {
        return new ImportedAsset(
                "asset-1", "project-1", "demo.zip", "ZIP", projectRoot,
                AssetStatus.READY, "", "2026-07-26T10:00:00Z", "2026-07-26T10:00:01Z", null);
    }
}
