package com.repograph.scanner;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.scanner.ScannerRequest;
import com.repograph.core.scanner.ScannerRunResult;
import com.repograph.core.scanner.ScannerRunStatus;
import com.repograph.finding.SarifFindingImporter;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link CodeQlScannerAdapter} 外部进程契约测试。
 *
 * @author leolu
 */
class CodeQlScannerAdapterTest {

    @TempDir
    Path tempDir;

    @Test
    void scan_createsControlledDatabaseAndNormalizesSarif() throws Exception {
        Path projectRoot = Files.createDirectory(tempDir.resolve("project"));
        Files.writeString(projectRoot.resolve("App.java"), "class App {}");
        Path command = fakeCodeQl();
        ScannerProperties properties = new ScannerProperties(
                tempDir.resolve("scan-work"), 5, 10, 10,
                "semgrep", "auto", command.toString(), "security-extended");
        CodeQlScannerAdapter adapter = new CodeQlScannerAdapter(
                properties, new SarifFindingImporter(new ObjectMapper()));

        ScannerRunResult result = adapter.scan(new ScannerRequest(
                "run-2", "project-1", projectRoot, List.of("java"), 5));

        assertThat(result.status()).isEqualTo(ScannerRunStatus.SUCCEEDED);
        assertThat(result.scanner()).isEqualTo("CODEQL");
        assertThat(result.toolVersion()).isEqualTo("2.20.0");
        assertThat(result.findings()).singleElement().satisfies(finding -> {
            assertThat(finding.tool()).isEqualTo("CodeQL");
            assertThat(finding.ruleId()).isEqualTo("java/command-line-injection");
            assertThat(finding.filePath()).isEqualTo("App.java");
        });
        assertThat(tempDir.resolve("scan-work/run-2/codeql/database-java")).isDirectory();
        assertThat(tempDir.resolve("scan-work/run-2/codeql/results-java.sarif")).isRegularFile();
        assertThat(projectRoot.resolve("database")).doesNotExist();
    }

    @Test
    void scan_analyzesEverySupportedLanguageWithoutExecutingProjectBuild() throws Exception {
        Path projectRoot = Files.createDirectory(tempDir.resolve("mixed-project"));
        Files.writeString(projectRoot.resolve("App.java"), "class App {}");
        Files.writeString(projectRoot.resolve("app.py"), "print('ok')");
        Path command = fakeCodeQl();
        ScannerProperties properties = new ScannerProperties(
                tempDir.resolve("scan-work"), 5, 10, 10,
                "semgrep", "auto", command.toString(), "security-extended");
        CodeQlScannerAdapter adapter = new CodeQlScannerAdapter(
                properties, new SarifFindingImporter(new ObjectMapper()));

        ScannerRunResult result = adapter.scan(new ScannerRequest(
                "run-mixed", "project-1", projectRoot, List.of("java", "python"), 5));

        assertThat(result.status()).isEqualTo(ScannerRunStatus.SUCCEEDED);
        assertThat(result.findings()).extracting(finding -> finding.filePath())
                .containsExactlyInAnyOrder("App.java", "app.py");
        assertThat(tempDir.resolve("scan-work/run-mixed/codeql/database-java")).isDirectory();
        assertThat(tempDir.resolve("scan-work/run-mixed/codeql/database-python")).isDirectory();
    }

    private Path fakeCodeQl() throws Exception {
        Path command = tempDir.resolve("fake-codeql");
        Files.writeString(command, """
                #!/bin/sh
                if [ "$1" = "--version" ]; then
                  echo "2.20.0"
                  exit 0
                fi
                if [ "$1" = "database" ] && [ "$2" = "create" ]; then
                  mkdir -p "$3"
                  exit 0
                fi
                if [ "$1" = "database" ] && [ "$2" = "analyze" ]; then
                  output=""
                  rule="java/command-line-injection"
                  file="App.java"
                  case "$3" in
                    *python*) rule="py/command-line-injection"; file="app.py" ;;
                  esac
                  for argument in "$@"; do
                    case "$argument" in
                      --output=*) output="${argument#--output=}" ;;
                    esac
                  done
                  cat > "$output" <<JSON
                {
                  "version": "2.1.0",
                  "runs": [{
                    "tool": {"driver": {"name": "CodeQL"}},
                    "results": [{
                      "ruleId": "$rule",
                      "level": "error",
                      "message": {"text": "command injection"},
                      "locations": [{
                        "physicalLocation": {
                          "artifactLocation": {"uri": "$file"},
                          "region": {"startLine": 3, "endLine": 3}
                        }
                      }]
                    }]
                  }]
                }
                JSON
                  exit 0
                fi
                exit 9
                """);
        Files.setPosixFilePermissions(command, PosixFilePermissions.fromString("rwxr-xr-x"));
        return command;
    }
}
