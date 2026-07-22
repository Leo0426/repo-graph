package com.repograph.core.finding;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link ExternalFinding} 统一报警模型测试。
 *
 * @author leolu
 */
class ExternalFindingTest {

    @Test
    void constructor_normalizesOptionalFieldsAndEmptyTrace() {
        ExternalFinding finding = new ExternalFinding(
                " semgrep ",
                "java.lang.security.audit.command-injection",
                null,
                null,
                " Runtime.exec receives user input ",
                " src/main/java/App.java ",
                42,
                0,
                null,
                null,
                null
        );

        assertThat(finding.tool()).isEqualTo("semgrep");
        assertThat(finding.cwe()).isEmpty();
        assertThat(finding.severity()).isEqualTo(ExternalFindingSeverity.UNKNOWN);
        assertThat(finding.filePath()).isEqualTo("src/main/java/App.java");
        assertThat(finding.endLine()).isEqualTo(42);
        assertThat(finding.symbol()).isEmpty();
        assertThat(finding.trace()).isEmpty();
        assertThat(finding.raw()).isEmpty();
    }

    @Test
    void constructor_preservesTraceSteps() {
        ExternalFindingTraceStep source = new ExternalFindingTraceStep(
                "src/main/java/App.java", 10, 10, "source", "handle", "HTTP parameter");
        ExternalFindingTraceStep sink = new ExternalFindingTraceStep(
                "src/main/java/App.java", 42, 42, "sink", "exec", "Runtime.exec");

        ExternalFinding finding = sample(List.of(source, sink));

        assertThat(finding.trace()).containsExactly(source, sink);
    }

    @Test
    void constructor_rejectsMissingRequiredFields() {
        assertThatThrownBy(() -> new ExternalFinding(
                "", "RULE", "CWE-78", ExternalFindingSeverity.HIGH,
                "message", "App.java", 1, 1, "", List.of(), "{}"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("tool");

        assertThatThrownBy(() -> new ExternalFinding(
                "semgrep", "", "CWE-78", ExternalFindingSeverity.HIGH,
                "message", "App.java", 1, 1, "", List.of(), "{}"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("ruleId");

        assertThatThrownBy(() -> new ExternalFinding(
                "semgrep", "RULE", "CWE-78", ExternalFindingSeverity.HIGH,
                "message", "App.java", 0, 1, "", List.of(), "{}"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("startLine");
    }

    @Test
    void fingerprint_isStableAndPositionSensitive() {
        ExternalFinding finding = sample(List.of());
        assertThat(finding.fingerprint())
                .isEqualTo(sample(List.of()).fingerprint())
                .hasSize(16)
                .matches("[0-9a-f]+");

        ExternalFinding otherLine = new ExternalFinding(
                finding.tool(), finding.ruleId(), finding.cwe(), finding.severity(),
                finding.message(), finding.filePath(), 43, 43,
                finding.symbol(), finding.trace(), finding.raw());
        assertThat(otherLine.fingerprint()).isNotEqualTo(finding.fingerprint());
    }

    @Test
    void severity_fromMapsCommonToolValues() {
        assertThat(ExternalFindingSeverity.from("error")).isEqualTo(ExternalFindingSeverity.CRITICAL);
        assertThat(ExternalFindingSeverity.from("moderate")).isEqualTo(ExternalFindingSeverity.MEDIUM);
        assertThat(ExternalFindingSeverity.from("note")).isEqualTo(ExternalFindingSeverity.INFO);
        assertThat(ExternalFindingSeverity.from("unknown-tool-value")).isEqualTo(ExternalFindingSeverity.UNKNOWN);
    }

    private static ExternalFinding sample(List<ExternalFindingTraceStep> trace) {
        return new ExternalFinding(
                "semgrep",
                "java.lang.security.audit.command-injection",
                "CWE-78",
                ExternalFindingSeverity.HIGH,
                "Runtime.exec receives user input",
                "src/main/java/App.java",
                42,
                42,
                "App#run(String)",
                trace,
                "{\"check_id\":\"java.lang.security.audit.command-injection\"}"
        );
    }
}
