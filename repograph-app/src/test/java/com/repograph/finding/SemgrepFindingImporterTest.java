package com.repograph.finding;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFindingSeverity;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link SemgrepFindingImporter} 测试。
 *
 * @author leolu
 */
class SemgrepFindingImporterTest {

    private final SemgrepFindingImporter importer = new SemgrepFindingImporter(new ObjectMapper());

    @Test
    void importJson_parsesSemgrepResultAndTrace() {
        String json = """
                {
                  "results": [{
                    "check_id": "java.lang.security.audit.command-injection",
                    "path": "src/main/java/App.java",
                    "start": {"line": 42},
                    "end": {"line": 44},
                    "extra": {
                      "severity": "ERROR",
                      "message": "Detected command injection",
                      "metadata": {
                        "cwe": ["CWE-78: OS Command Injection"],
                        "function": "App.run"
                      },
                      "dataflow_trace": {
                        "taint_source": {
                          "location": {"path": "src/main/java/App.java", "start": {"line": 10}},
                          "content": "request parameter"
                        },
                        "taint_sink": {
                          "location": {"path": "src/main/java/App.java", "start": {"line": 42}},
                          "content": "Runtime.exec"
                        }
                      }
                    }
                  }]
                }""";

        var findings = importer.importJson(json);

        assertThat(findings).hasSize(1);
        var finding = findings.getFirst();
        assertThat(finding.tool()).isEqualTo("semgrep");
        assertThat(finding.ruleId()).isEqualTo("java.lang.security.audit.command-injection");
        assertThat(finding.cwe()).isEqualTo("CWE-78");
        assertThat(finding.severity()).isEqualTo(ExternalFindingSeverity.CRITICAL);
        assertThat(finding.filePath()).isEqualTo("src/main/java/App.java");
        assertThat(finding.startLine()).isEqualTo(42);
        assertThat(finding.trace()).hasSize(2);
        assertThat(finding.trace()).extracting("kind").containsExactly("source", "sink");
    }

    @Test
    void importJson_invalidJsonThrowsDiagnosticError() {
        assertThatThrownBy(() -> importer.importJson("{not-json"))
                .isInstanceOf(ExternalFindingImportException.class)
                .hasMessageContaining("Invalid Semgrep JSON");
    }
}
