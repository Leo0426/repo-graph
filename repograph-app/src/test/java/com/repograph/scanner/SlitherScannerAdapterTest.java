package com.repograph.scanner;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.scanner.ScannerAvailability;
import com.repograph.core.scanner.ScannerRequest;
import com.repograph.core.scanner.ScannerRunResult;
import com.repograph.core.scanner.ScannerRunStatus;
import com.repograph.finding.SlitherFindingImporter;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link SlitherScannerAdapter} 外部进程契约测试。
 *
 * @author leolu
 */
class SlitherScannerAdapterTest {

    @TempDir
    Path tempDir;

    @Test
    void scan_runsCliAndNormalizesUnlocatableFindings() throws Exception {
        Path projectRoot = Files.createDirectory(tempDir.resolve("project"));
        Files.writeString(projectRoot.resolve("Bank.sol"), "contract Bank {}");
        Path command = fakeSlither();
        SlitherScannerAdapter adapter = new SlitherScannerAdapter(
                properties(), new SlitherFindingImporter(new ObjectMapper()), command.toString());

        ScannerRunResult result = adapter.scan(new ScannerRequest(
                "run-1", "project-1", projectRoot, List.of("solidity"), 5));

        assertThat(result.status()).isEqualTo(ScannerRunStatus.SUCCEEDED);
        assertThat(result.scanner()).isEqualTo("SLITHER");
        assertThat(result.findings()).singleElement().satisfies(finding -> {
            assertThat(finding.tool()).isEqualTo("slither");
            assertThat(finding.ruleId()).isEqualTo("reentrancy-eth");
            assertThat(finding.filePath()).isEqualTo("contracts/Bank.sol");
            assertThat(finding.startLine()).isEqualTo(23);
            assertThat(finding.trace()).anySatisfy(step ->
                    assertThat(step.kind()).isEqualTo(SlitherFindingImporter.CONTEXT_UNAVAILABLE_KIND));
        });
        assertThat(tempDir.resolve("scan-work/run-1/slither/results.json")).isRegularFile();
    }

    @Test
    void probeAndScan_reportUnavailableWhenCommandMissing() throws Exception {
        Path projectRoot = Files.createDirectory(tempDir.resolve("project"));
        SlitherScannerAdapter adapter = new SlitherScannerAdapter(
                properties(), new SlitherFindingImporter(new ObjectMapper()),
                tempDir.resolve("missing-slither").toString());

        ScannerAvailability availability = adapter.probe();
        ScannerRunResult result = adapter.scan(new ScannerRequest(
                "run-missing", "project-1", projectRoot, List.of("solidity"), 5));

        assertThat(availability.available()).isFalse();
        assertThat(availability.error()).isNotBlank();
        assertThat(result.status()).isEqualTo(ScannerRunStatus.UNAVAILABLE);
        assertThat(result.findings()).isEmpty();
    }

    private ScannerProperties properties() {
        return new ScannerProperties(
                tempDir.resolve("scan-work"), 5, 10, 10,
                "semgrep", "auto", "codeql", "security-extended");
    }

    private Path fakeSlither() throws Exception {
        Path command = tempDir.resolve("fake-slither");
        Files.writeString(command, """
                #!/bin/sh
                if [ "$1" = "--version" ]; then
                  echo "0.10.0"
                  exit 0
                fi
                # args: . --json <output>
                out="$3"
                cat > "$out" <<'JSON'
                {
                  "results": {
                    "detectors": [
                      {
                        "check": "reentrancy-eth",
                        "impact": "High",
                        "description": "Reentrancy in Bank.withdraw()",
                        "elements": [
                          {
                            "name": "withdraw",
                            "source_mapping": {
                              "filename_relative": "contracts/Bank.sol",
                              "lines": [23, 24, 25]
                            }
                          }
                        ]
                      }
                    ]
                  }
                }
                JSON
                exit 0
                """);
        Files.setPosixFilePermissions(command, PosixFilePermissions.fromString("rwxr-xr-x"));
        return command;
    }
}
