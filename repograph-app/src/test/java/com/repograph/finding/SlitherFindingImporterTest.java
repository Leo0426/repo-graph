package com.repograph.finding;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.ExternalFindingTraceStep;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link SlitherFindingImporter} 归一化与「无 Solidity 索引 → 不可定位」标记测试。
 *
 * @author leolu
 */
class SlitherFindingImporterTest {

    private final SlitherFindingImporter importer = new SlitherFindingImporter(new ObjectMapper());

    private static final String SLITHER_JSON = """
            {
              "success": true,
              "error": null,
              "results": {
                "detectors": [
                  {
                    "check": "reentrancy-eth",
                    "impact": "High",
                    "confidence": "Medium",
                    "description": "Reentrancy in Bank.withdraw() allows re-entrant calls\\n",
                    "elements": [
                      {
                        "type": "function",
                        "name": "withdraw",
                        "source_mapping": {
                          "filename_relative": "contracts/Bank.sol",
                          "filename_short": "contracts/Bank.sol",
                          "lines": [23, 24, 25, 26]
                        }
                      }
                    ]
                  },
                  {
                    "check": "solc-version",
                    "impact": "Informational",
                    "confidence": "High",
                    "description": "Pragma version constraint is too wide",
                    "elements": [
                      {
                        "type": "pragma",
                        "name": "solidity ^0.8.0",
                        "source_mapping": {
                          "filename_relative": "contracts/Bank.sol",
                          "lines": [1]
                        }
                      }
                    ]
                  }
                ]
              }
            }
            """;

    @Test
    void normalizesDetectorsToExternalFindings() {
        assertThat(importer.supports("slither")).isTrue();

        List<ExternalFinding> findings = importer.importJson(SLITHER_JSON);
        assertThat(findings).hasSize(2);

        ExternalFinding reentrancy = findings.get(0);
        assertThat(reentrancy.tool()).isEqualTo("slither");
        assertThat(reentrancy.ruleId()).isEqualTo("reentrancy-eth");
        assertThat(reentrancy.severity()).isEqualTo(ExternalFindingSeverity.HIGH);
        assertThat(reentrancy.filePath()).isEqualTo("contracts/Bank.sol");
        assertThat(reentrancy.startLine()).isEqualTo(23);
        assertThat(reentrancy.endLine()).isEqualTo(26);
        assertThat(reentrancy.symbol()).isEqualTo("withdraw");
        assertThat(reentrancy.cwe()).isEmpty();

        assertThat(findings.get(1).severity()).isEqualTo(ExternalFindingSeverity.INFO);
        assertThat(findings.get(1).startLine()).isEqualTo(1);
    }

    @Test
    void marksEveryFindingAsContextUnavailableWithoutFabricatingLocation() {
        List<ExternalFinding> findings = importer.importJson(SLITHER_JSON);

        for (ExternalFinding finding : findings) {
            List<ExternalFindingTraceStep> marks = finding.trace().stream()
                    .filter(step -> SlitherFindingImporter.CONTEXT_UNAVAILABLE_KIND.equals(step.kind()))
                    .toList();
            assertThat(marks).hasSize(1);
            // 标记复用 Slither 自带的真实文件/行号，不编造定位。
            assertThat(marks.get(0).filePath()).isEqualTo(finding.filePath());
            assertThat(marks.get(0).startLine()).isEqualTo(finding.startLine());
        }
    }

    @Test
    void rejectsJsonWithoutDetectors() {
        assertThatThrownBy(() -> importer.importJson("{\"results\":{}}"))
                .isInstanceOf(ExternalFindingImportException.class);
    }
}
