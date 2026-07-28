package com.repograph.finding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.ExternalFindingTraceStep;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.finding.RuleSuppression;
import com.repograph.core.finding.RuleSuppressionScope;
import com.repograph.core.finding.TriageFeedback;
import com.repograph.core.finding.TriageFeedbackStatus;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageReviewContext;
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
    void build_matchingVersionFalsePositiveFeedbackIsAppliedWithProvenance() {
        FindingContext context = context(List.of(
                locationEvidence(List.of("command_execution", "entry_point"))));
        TriageFeedback feedback = new TriageFeedback(
                context.finding().fingerprint(),
                "project-1",
                TriageFeedbackStatus.FALSE_POSITIVE,
                "leo",
                "该调用参数来自固定枚举",
                "commit-a",
                "semgrep-rules-2",
                "2026-07-26T12:00:00Z");

        TriageReport report = service.build(
                context,
                new TriageReviewContext(
                        "project-1",
                        "commit-a",
                        "semgrep-rules-2",
                        feedback));

        assertThat(report.verdict()).isEqualTo(TriageVerdict.LIKELY_FALSE_POSITIVE);
        assertThat(report.confidence()).isGreaterThanOrEqualTo(0.9f);
        assertThat(report.decisionEvidence()).singleElement().satisfies(evidence -> {
            assertThat(evidence.source()).isEqualTo("HISTORICAL_FEEDBACK");
            assertThat(evidence.reference()).isEqualTo(context.finding().fingerprint());
            assertThat(evidence.applied()).isTrue();
            assertThat(evidence.summary()).contains("leo", "固定枚举", "commit-a", "semgrep-rules-2");
        });
        assertThat(report.finding()).isSameAs(context.finding());
        assertThat(service.toMarkdown(report))
                .contains("### 决策证据")
                .contains("HISTORICAL_FEEDBACK")
                .contains(context.finding().fingerprint())
                .contains("applied=true");
    }

    @Test
    void build_changedCodeVersionDoesNotReuseFalsePositiveFeedback() {
        FindingContext context = context(List.of(
                locationEvidence(List.of("command_execution", "entry_point"))));
        TriageFeedback feedback = new TriageFeedback(
                context.finding().fingerprint(),
                "project-1",
                TriageFeedbackStatus.FALSE_POSITIVE,
                "leo",
                "旧版本已有校验",
                "commit-old",
                "semgrep-rules-2",
                "2026-07-25T12:00:00Z");

        TriageReport report = service.build(
                context,
                new TriageReviewContext(
                        "project-1",
                        "commit-new",
                        "semgrep-rules-2",
                        feedback));

        assertThat(report.verdict()).isEqualTo(TriageVerdict.TRUE_RISK);
        assertThat(report.decisionEvidence()).singleElement().satisfies(evidence -> {
            assertThat(evidence.source()).isEqualTo("HISTORICAL_FEEDBACK");
            assertThat(evidence.applied()).isFalse();
            assertThat(evidence.summary()).contains("version mismatch");
        });
        assertThat(report.missingInfo()).anyMatch(info -> info.contains("历史反馈") && info.contains("版本"));
    }

    @Test
    void build_activeRuleSuppressionIsAppliedWithoutChangingFindingFact() {
        FindingContext context = context(List.of(
                locationEvidence(List.of("command_execution", "entry_point"))));
        RuleSuppression suppression = new RuleSuppression(
                "suppression-1",
                "project-1",
                context.finding().ruleId(),
                RuleSuppressionScope.PROJECT,
                "",
                "training fixture",
                "leo",
                "2026-07-20T00:00:00Z",
                "2026-08-20T00:00:00Z",
                true);

        TriageReport report = service.build(
                context,
                new TriageReviewContext(
                        "project-1",
                        "commit-a",
                        "rules-2",
                        null,
                        suppression));

        assertThat(report.verdict()).isEqualTo(TriageVerdict.LIKELY_FALSE_POSITIVE);
        assertThat(report.decisionEvidence()).singleElement().satisfies(evidence -> {
            assertThat(evidence.source()).isEqualTo("RULE_SUPPRESSION");
            assertThat(evidence.reference()).isEqualTo("suppression-1");
            assertThat(evidence.summary()).contains("PROJECT", "training fixture", "leo", "2026-08-20");
            assertThat(evidence.applied()).isTrue();
        });
        assertThat(report.finding()).isSameAs(context.finding());
    }

    @Test
    void build_protectionWithoutTraceDoesNotReduceRiskConclusion() {
        ContextEvidence protectedLocation = new ContextEvidence(
                "C1", "com.example.OrderService#run()", "METHOD", "java",
                "src/main/java/com/example/OrderService.java", 40, 60,
                "FINDING", "SEED", 1.0f,
                "if (!command.matches(\"[a-z]+\")) { throw new IllegalArgumentException(); }\n"
                        + "Runtime.getRuntime().exec(command);",
                false, List.of("command_execution"));
        FindingContext context = context(List.of(protectedLocation, callerEvidence()));

        TriageReport report = service.build(context);

        assertThat(report.verdict()).isEqualTo(TriageVerdict.TRUE_RISK);
        assertThat(report.reasons())
                .anyMatch(reason -> reason.contains("防护") && reason.contains("[C1]"));
        assertThat(report.decisionEvidence()).singleElement()
                .satisfies(evidence -> assertThat(evidence.applied()).isFalse());
        assertThat(report.missingInfo()).anyMatch(info -> info.contains("未降低风险结论"));
    }

    @Test
    void build_pathAlignedProtectionCanReduceConclusionToNeedsReview() {
        ExternalFinding tracedFinding = finding(List.of(
                traceStep(10, "source", "request parameter"),
                traceStep(45, "sanitizer", "allowlist validation"),
                traceStep(52, "sink", "Runtime.exec")));
        ContextEvidence protectedLocation = new ContextEvidence(
                "C1", "com.example.OrderService#run()", "METHOD", "java",
                "src/main/java/com/example/OrderService.java", 40, 60,
                "FINDING", "SEED", 1.0f,
                "if (!command.matches(\"[a-z]+\")) { throw new IllegalArgumentException(); }\n"
                        + "Runtime.getRuntime().exec(command);",
                false, List.of("command_execution", "entry_point"));
        FindingContext context = new FindingContext(
                tracedFinding,
                true,
                protectedLocation.qualifiedName(),
                pack(List.of(protectedLocation), List.of()));

        TriageReport report = service.build(context);

        assertThat(report.verdict()).isEqualTo(TriageVerdict.NEEDS_REVIEW);
        assertThat(report.decisionEvidence()).singleElement().satisfies(evidence -> {
            assertThat(evidence.source()).isEqualTo("PATH_PROTECTION");
            assertThat(evidence.reference()).isEqualTo("C1");
            assertThat(evidence.applied()).isTrue();
            assertThat(evidence.summary()).contains("source", "sanitizer", "sink");
        });
        assertThat(report.reasons()).anyMatch(reason -> reason.contains("路径") && reason.contains("[C1]"));
    }

    @Test
    void build_secondSourceAfterProtectionIsTreatedAsBypass() {
        ExternalFinding tracedFinding = finding(List.of(
                traceStep(10, "source", "request parameter"),
                traceStep(45, "sanitizer", "allowlist validation"),
                traceStep(48, "source", "message queue payload"),
                traceStep(52, "sink", "Runtime.exec")));
        ContextEvidence protectedLocation = new ContextEvidence(
                "C1", "com.example.OrderService#run()", "METHOD", "java",
                "src/main/java/com/example/OrderService.java", 40, 60,
                "FINDING", "SEED", 1.0f,
                "if (!command.matches(\"[a-z]+\")) { throw new IllegalArgumentException(); }\n"
                        + "Runtime.getRuntime().exec(command);",
                false, List.of("command_execution", "entry_point"));
        FindingContext context = new FindingContext(
                tracedFinding,
                true,
                protectedLocation.qualifiedName(),
                pack(List.of(protectedLocation), List.of()));

        TriageReport report = service.build(context);

        assertThat(report.verdict()).isEqualTo(TriageVerdict.TRUE_RISK);
        assertThat(report.decisionEvidence()).singleElement().satisfies(evidence -> {
            assertThat(evidence.source()).isEqualTo("PATH_PROTECTION");
            assertThat(evidence.applied()).isFalse();
            assertThat(evidence.summary()).contains("not between every source and sink");
        });
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
    void toMarkdownSummary_combinesReportsWithVerdictCounts() {
        TriageReport trueRisk = service.build(context(List.of(
                locationEvidence(List.of("command_execution")), callerEvidence())));
        TriageReport falsePositive = service.build(context(List.of(locationEvidence(List.of()))));

        String summary = service.toMarkdownSummary(List.of(trueRisk, falsePositive));

        assertThat(summary)
                .contains("2 条报警")
                .contains("TRUE_RISK × 1")
                .contains("LIKELY_FALSE_POSITIVE × 1")
                .contains("<details>")
                .contains("</details>");
    }

    @Test
    void toMarkdownSummary_emptyListReturnsNoFindingsMessage() {
        String summary = service.toMarkdownSummary(List.of());

        assertThat(summary).contains("未发现可研判的报警");
    }

    @Test
    void report_serializesWithStableJsonFields() throws Exception {
        TriageReport report = service.build(context(List.of(
                locationEvidence(List.of("command_execution")),
                callerEvidence())));

        JsonNode json = new ObjectMapper().valueToTree(report);

        assertThat(json.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "finding", "located", "locatedQualifiedName", "verdict", "confidence",
                "reasons", "missingInfo", "remediation", "developerSummary", "pack",
                "decisionEvidence");
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
        return finding(List.of());
    }

    private static ExternalFinding finding(List<ExternalFindingTraceStep> trace) {
        return new ExternalFinding("semgrep", "java.lang.security.audit.command-injection",
                "CWE-78", ExternalFindingSeverity.HIGH,
                "Detected command injection via Runtime.exec",
                "src/main/java/com/example/OrderService.java", 42, 42,
                "run", trace, "{}");
    }

    private static ExternalFindingTraceStep traceStep(int line, String kind, String message) {
        return new ExternalFindingTraceStep(
                "src/main/java/com/example/OrderService.java",
                line,
                line,
                kind,
                "run",
                message);
    }
}
