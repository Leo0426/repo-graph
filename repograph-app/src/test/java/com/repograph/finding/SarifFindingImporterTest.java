package com.repograph.finding;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFindingSeverity;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link SarifFindingImporter} 测试。
 *
 * @author leolu
 */
class SarifFindingImporterTest {

    private final SarifFindingImporter importer = new SarifFindingImporter(new ObjectMapper());

    @Test
    void importJson_parsesSarifResultAndCodeFlow() {
        String json = """
                {
                  "version": "2.1.0",
                  "runs": [{
                    "tool": {
                      "driver": {
                        "name": "CodeQL",
                        "rules": [{
                          "id": "java/command-line-injection",
                          "properties": {"tags": ["security", "external/cwe/cwe-078"]}
                        }]
                      }
                    },
                    "results": [{
                      "ruleId": "java/command-line-injection",
                      "level": "error",
                      "message": {"text": "This command depends on a user-provided value."},
                      "locations": [{
                        "physicalLocation": {
                          "artifactLocation": {"uri": "src/main/java/App.java"},
                          "region": {"startLine": 42, "endLine": 42}
                        },
                        "logicalLocations": [{"fullyQualifiedName": "com.example.App.run"}]
                      }],
                      "codeFlows": [{
                        "threadFlows": [{
                          "locations": [{
                            "kinds": ["source"],
                            "location": {
                              "message": {"text": "user input"},
                              "physicalLocation": {
                                "artifactLocation": {"uri": "src/main/java/App.java"},
                                "region": {"startLine": 10}
                              }
                            }
                          }, {
                            "kinds": ["sink"],
                            "location": {
                              "message": {"text": "Runtime.exec"},
                              "physicalLocation": {
                                "artifactLocation": {"uri": "src/main/java/App.java"},
                                "region": {"startLine": 42}
                              }
                            }
                          }]
                        }]
                      }]
                    }]
                  }]
                }""";

        var findings = importer.importJson(json);

        assertThat(findings).hasSize(1);
        var finding = findings.getFirst();
        assertThat(finding.tool()).isEqualTo("CodeQL");
        assertThat(finding.ruleId()).isEqualTo("java/command-line-injection");
        assertThat(finding.cwe()).isEqualTo("CWE-078");
        assertThat(finding.severity()).isEqualTo(ExternalFindingSeverity.CRITICAL);
        assertThat(finding.symbol()).isEqualTo("com.example.App.run");
        assertThat(finding.trace()).hasSize(2);
        assertThat(finding.trace()).extracting("kind").containsExactly("source", "sink");
    }

    @Test
    void importJson_invalidShapeThrowsDiagnosticError() {
        assertThatThrownBy(() -> importer.importJson("{}"))
                .isInstanceOf(ExternalFindingImportException.class)
                .hasMessageContaining("runs array");
    }

    @Test
    void importJson_streamsMultipleRunsAndResults() {
        String json = """
                {
                  "version": "2.1.0",
                  "runs": [{
                    "tool": {"driver": {"name": "CodeQL", "rules": [
                      {"id": "rule-a", "properties": {"tags": ["external/cwe/cwe-078"]}}
                    ]}},
                    "results": [
                      {"ruleId": "rule-a", "level": "error", "message": {"text": "first"},
                       "locations": [{"physicalLocation": {"artifactLocation": {"uri": "A.java"},
                       "region": {"startLine": 1}}}]},
                      {"ruleId": "rule-b", "level": "warning", "message": {"text": "second"},
                       "locations": [{"physicalLocation": {"artifactLocation": {"uri": "B.java"},
                       "region": {"startLine": 2}}}]}
                    ]
                  }, {
                    "automationDetails": {"id": "secondary"},
                    "results": [
                      {"ruleId": "rule-c", "message": {"text": "third"},
                       "locations": [{"physicalLocation": {"artifactLocation": {"uri": "C.java"},
                       "region": {"startLine": 3}}}]}
                    ]
                  }]
                }
                """;

        var findings = importer.importJson(new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));

        assertThat(findings).hasSize(3);
        assertThat(findings).extracting("tool").containsExactly("CodeQL", "CodeQL", "secondary");
        assertThat(findings.getFirst().cwe()).isEqualTo("CWE-078");
    }

    @Test
    void importJson_limitsRetainedFindingsWhileStreaming() {
        String json = """
                {"runs":[{"tool":{"driver":{"name":"CodeQL"}},"results":[
                  {"ruleId":"one","message":{"text":"one"},"locations":[{"physicalLocation":{
                   "artifactLocation":{"uri":"A.java"},"region":{"startLine":1}}}]},
                  {"ruleId":"two","message":{"text":"two"},"locations":[{"physicalLocation":{
                   "artifactLocation":{"uri":"B.java"},"region":{"startLine":2}}}]},
                  {"ruleId":"three","message":{"text":"three"},"locations":[{"physicalLocation":{
                   "artifactLocation":{"uri":"C.java"},"region":{"startLine":3}}}]}
                ]}]}
                """;

        var findings = importer.importJson(
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)), 2);

        assertThat(findings).extracting("ruleId").containsExactly("one", "two");
    }
}
