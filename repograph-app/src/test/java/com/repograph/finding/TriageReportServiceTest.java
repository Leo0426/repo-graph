package com.repograph.finding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
import com.repograph.core.retrieval.ContextEvidence;
import com.repograph.core.retrieval.ContextPack;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link TriageReportService} 行为测试。
 *
 * @author leolu
 */
class TriageReportServiceTest {

    private final TriageReportService service = new TriageReportService();

    @Test
    void build_trueRiskWhenLocationHasSignalsAndCallers() {
        FindingContext context = context(List.of(
                locationEvidence(List.of("command_execution", "entry_point")),
                callerEvidence()));

        TriageReport report = service.build(context);

        assertThat(report.verdict()).isEqualTo(TriageVerdict.TRUE_RISK);
        assertThat(report.confidence()).isBetween(0.5f, 0.9f);
        assertThat(report.reasons()).anyMatch(r -> r.contains("[C1]"));
        assertThat(report.remediation()).contains("ProcessBuilder");
        assertThat(report.missingInfo())
                .anyMatch(info -> info.contains("trace"));
    }

    @Test
    void build_trueRiskWhenEntryPointHasSignalsButNoCallers() {
        // A Spring @RequestMapping handler is itself the entry point: its real caller is an
        // external HTTP request, so the repo call graph will never show any in-repo caller.
        // Regression for the vulnado/java-sec-code validation finding where this used to be
        // capped at NEEDS_REVIEW purely because callers == 0.
        FindingContext context = context(List.of(
                locationEvidence(List.of("command_execution", "entry_point"))));

        TriageReport report = service.build(context);

        assertThat(report.verdict()).isEqualTo(TriageVerdict.TRUE_RISK);
        assertThat(report.reasons()).anyMatch(r -> r.contains("入口点") || r.contains("entry_point"));
    }

    @Test
    void build_needsReviewWhenCweSpecificProtectionIsPresent() {
        ContextEvidence protectedLocation = new ContextEvidence(
                "C1", "com.example.OrderService#run()", "METHOD", "java",
                "src/main/java/com/example/OrderService.java", 40, 60,
                "FINDING", "SEED", 1.0f,
                "if (!command.matches(\"[a-z]+\")) { throw new IllegalArgumentException(); }\n"
                        + "Runtime.getRuntime().exec(command);",
                false, List.of("command_execution"));
        FindingContext context = context(List.of(protectedLocation, callerEvidence()));

        TriageReport report = service.build(context);

        assertThat(report.verdict()).isEqualTo(TriageVerdict.NEEDS_REVIEW);
        assertThat(report.reasons())
                .anyMatch(reason -> reason.contains("输入校验") && reason.contains("[C1]"));
        assertThat(report.developerSummary()).contains("防护");
    }

    @Test
    void build_ignoresProtectionMarkerFoundOnlyInCaller() {
        ContextEvidence unrelatedCaller = new ContextEvidence(
                "C2", "com.example.OrderController#submit()", "METHOD", "java",
                "src/main/java/com/example/OrderController.java", 20, 30,
                "CALL_GRAPH", "CALLER", 0.6f,
                "boolean unrelated = username.matches(\"[a-z]+\");",
                false, List.of());
        FindingContext context = context(List.of(
                locationEvidence(List.of("command_execution")), unrelatedCaller));

        TriageReport report = service.build(context);

        assertThat(report.verdict()).isEqualTo(TriageVerdict.TRUE_RISK);
        assertThat(report.reasons()).noneMatch(reason -> reason.contains("候选防护"));
    }

    @Test
    void build_likelyFalsePositiveWhenNoSignalsAndNoCallers() {
        FindingContext context = context(List.of(locationEvidence(List.of())));

        TriageReport report = service.build(context);

        assertThat(report.verdict()).isEqualTo(TriageVerdict.LIKELY_FALSE_POSITIVE);
        assertThat(report.confidence()).isPositive();
        assertThat(report.developerSummary()).contains("误报");
    }

    @Test
    void build_needsReviewWithMissingInfoWhenNotLocated() {
        ContextPack pack = pack(List.of(),
                List.of("finding location not indexed: src/main/java/com/example/OrderService.java:42"));
        FindingContext context = new FindingContext(finding(), false, "", pack);

        TriageReport report = service.build(context);

        assertThat(report.verdict()).isEqualTo(TriageVerdict.NEEDS_REVIEW);
        assertThat(report.missingInfo()).anyMatch(info -> info.contains("未被索引"));
    }

    @Test
    void toMarkdown_containsCitationVerdictAndSections() {
        TriageReport report = service.build(context(List.of(
                locationEvidence(List.of("command_execution")),
                callerEvidence())));

        String markdown = service.toMarkdown(report);

        assertThat(markdown)
                .contains("[C1]")
                .contains("TRUE_RISK")
                .contains("置信度")
                .contains("### 证据")
                .contains("### 修复建议")
                .contains("### 缺失信息");
    }

    @Test
    void report_serializesWithStableJsonFields() throws Exception {
        TriageReport report = service.build(context(List.of(
                locationEvidence(List.of("command_execution")),
                callerEvidence())));

        JsonNode json = new ObjectMapper().valueToTree(report);

        assertThat(json.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "finding", "located", "locatedQualifiedName", "verdict", "confidence",
                "reasons", "missingInfo", "remediation", "developerSummary", "pack");
        assertThat(json.get("verdict").asText()).isEqualTo("TRUE_RISK");
    }

    private static FindingContext context(List<ContextEvidence> evidence) {
        return new FindingContext(finding(), true, "com.example.OrderService#run()",
                pack(evidence, List.of()));
    }

    private static ContextPack pack(List<ContextEvidence> evidence, List<String> omitted) {
        return new ContextPack("q", "security", evidence, omitted,
                12000, 100, evidence.isEmpty() ? 0 : 1, 0, 0, 0);
    }

    private static ContextEvidence locationEvidence(List<String> signals) {
        return new ContextEvidence("C1", "com.example.OrderService#run()", "METHOD", "java",
                "src/main/java/com/example/OrderService.java", 40, 60,
                "FINDING", "SEED", 1.0f, "void run() { ... }", false, signals);
    }

    private static ContextEvidence callerEvidence() {
        return new ContextEvidence("C2", "com.example.OrderController#submit()", "METHOD", "java",
                "src/main/java/com/example/OrderController.java", 20, 30,
                "CALL_GRAPH", "CALLER", 0.6f, "void submit() { ... }", false, List.of());
    }

    private static ExternalFinding finding() {
        return new ExternalFinding("semgrep", "java.lang.security.audit.command-injection",
                "CWE-78", ExternalFindingSeverity.HIGH,
                "Detected command injection via Runtime.exec",
                "src/main/java/com/example/OrderService.java", 42, 42,
                "run", List.of(), "{}");
    }
}
