package com.repograph.scanner;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.scanner.ScannerRequest;
import com.repograph.core.scanner.ScannerAvailability;
import com.repograph.core.scanner.ScannerRunResult;
import com.repograph.core.scanner.ScannerRunStatus;
import com.repograph.finding.SemgrepFindingImporter;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link SemgrepScannerAdapter} 外部进程契约测试。
 *
 * @author leolu
 */
class SemgrepScannerAdapterTest {

    @TempDir
    Path tempDir;

    @Test
    void scan_runsCliWithControlledOutputAndNormalizesFindings() throws Exception {
        Path projectRoot = Files.createDirectory(tempDir.resolve("project"));
        Files.writeString(projectRoot.resolve("App.java"), "class App {}");
        Path command = fakeSemgrep();
        ScannerProperties properties = new ScannerProperties(
                tempDir.resolve("scan-work"), 5, 10, 10,
                command.toString(), "auto", "codeql", "security-extended");
        SemgrepScannerAdapter adapter = new SemgrepScannerAdapter(
                properties, new SemgrepFindingImporter(new ObjectMapper()));

        ScannerRunResult result = adapter.scan(new ScannerRequest(
                "run-1", "project-1", projectRoot, List.of("java"), 5));

        assertThat(result.status()).isEqualTo(ScannerRunStatus.SUCCEEDED);
        assertThat(result.scanner()).isEqualTo("SEMGREP");
        assertThat(result.toolVersion()).isEqualTo("1.99.0");
        assertThat(result.exitCode()).isZero();
        assertThat(result.findings()).singleElement().satisfies(finding -> {
            assertThat(finding.tool()).isEqualTo("semgrep");
            assertThat(finding.ruleId()).isEqualTo("java.lang.security.audit.command-injection");
            assertThat(finding.filePath()).isEqualTo("App.java");
            assertThat(finding.fingerprint()).isNotBlank();
        });
        assertThat(tempDir.resolve("scan-work/run-1/semgrep/results.json")).isRegularFile();
        assertThat(projectRoot.resolve("results.json")).doesNotExist();
    }

    @Test
    void probeAndScan_reportUnavailableWhenCommandIsMissing() throws Exception {
        Path projectRoot = Files.createDirectory(tempDir.resolve("project"));
        ScannerProperties properties = new ScannerProperties(
                tempDir.resolve("scan-work"), 5, 10, 10,
                tempDir.resolve("missing-semgrep").toString(), "auto", "codeql", "security-extended");
        SemgrepScannerAdapter adapter = new SemgrepScannerAdapter(
                properties, new SemgrepFindingImporter(new ObjectMapper()));

        ScannerAvailability availability = adapter.probe();
        ScannerRunResult result = adapter.scan(new ScannerRequest(
                "run-missing", "project-1", projectRoot, List.of("java"), 5));

        assertThat(availability.available()).isFalse();
        assertThat(availability.toolVersion()).isEmpty();
        assertThat(availability.error()).isNotBlank();
        assertThat(result.status()).isEqualTo(ScannerRunStatus.UNAVAILABLE);
        assertThat(result.findings()).isEmpty();
        assertThat(result.error()).isNotBlank();
    }

    @Test
    void scan_forciblyTerminatesProcessWhenTimeoutExpires() throws Exception {
        Path projectRoot = Files.createDirectory(tempDir.resolve("project"));
        Path command = tempDir.resolve("slow-semgrep");
        Files.writeString(command, """
                #!/bin/sh
                if [ "$1" = "--version" ]; then
                  echo "1.99.0"
                  exit 0
                fi
                sleep 10
                """);
        Files.setPosixFilePermissions(command, PosixFilePermissions.fromString("rwxr-xr-x"));
        ScannerProperties properties = new ScannerProperties(
                tempDir.resolve("scan-work"), 1, 10, 10,
                command.toString(), "auto", "codeql", "security-extended");
        SemgrepScannerAdapter adapter = new SemgrepScannerAdapter(
                properties, new SemgrepFindingImporter(new ObjectMapper()));

        ScannerRunResult result = adapter.scan(new ScannerRequest(
                "run-timeout", "project-1", projectRoot, List.of("java"), 1));

        assertThat(result.status()).isEqualTo(ScannerRunStatus.TIMED_OUT);
        assertThat(result.exitCode()).isEqualTo(-1);
        assertThat(result.findings()).isEmpty();
        assertThat(result.durationMs()).isLessThan(5_000);
    }

    private Path fakeSemgrep() throws Exception {
        Path command = tempDir.resolve("fake-semgrep");
        Files.writeString(command, """
                #!/bin/sh
                if [ "$1" = "--version" ]; then
                  echo "1.99.0"
                  exit 0
                fi
                output=""
                previous=""
                for argument in "$@"; do
                  if [ "$previous" = "--output" ]; then output="$argument"; fi
                  previous="$argument"
                done
                cat > "$output" <<'JSON'
                {
                  "results": [{
                    "check_id": "java.lang.security.audit.command-injection",
                    "path": "App.java",
                    "start": {"line": 3},
                    "end": {"line": 3},
                    "extra": {"severity": "ERROR", "message": "command injection"}
                  }]
                }
                JSON
                """);
        Files.setPosixFilePermissions(command, PosixFilePermissions.fromString("rwxr-xr-x"));
        return command;
    }
}
