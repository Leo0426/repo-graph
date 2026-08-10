package com.repograph.agent;

import com.repograph.core.advisory.LlmAdvisoryResult;
import com.repograph.core.advisory.LlmAdvisoryService;
import com.repograph.core.advisory.LlmAdvisoryStatus;
import com.repograph.core.agent.AgentPlaybook;
import com.repograph.core.agent.AgentRun;
import com.repograph.core.agent.AgentRunStatus;
import com.repograph.core.agent.AgentStep;
import com.repograph.core.agent.AgentStepResult;
import com.repograph.core.agent.AgentStepStatus;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.finding.ReportSnapshot;
import com.repograph.core.finding.RuleSuppression;
import com.repograph.core.finding.TriageFeedback;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageReviewContext;
import com.repograph.core.retrieval.ContextPackOptions;
import com.repograph.core.retrieval.GraphRagOptions;
import com.repograph.finding.ExternalFindingImporter;
import com.repograph.finding.FindingContextService;
import com.repograph.finding.ReviewQueueStore;
import com.repograph.finding.RuleSuppressionStore;
import com.repograph.finding.TriageFeedbackStore;
import com.repograph.finding.TriageReportService;
import com.repograph.vuln.VulnFinding;
import com.repograph.vuln.VulnStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.info.BuildProperties;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executor;

/**
 * 执行平台原生 SAST 研判 Playbook，并把公开步骤和事实引用写入 Agent 时间线。
 *
 * @author leolu
 */
@Service
public class SastTriageAgentService {

    private static final Logger log = LoggerFactory.getLogger(SastTriageAgentService.class);
    private static final String PLAYBOOK_VERSION = "1";
    private static final int MAX_FINDINGS_PER_RUN = 50;
    private static final int MIN_BUDGET_CHARS = 1000;
    private static final int MAX_BUDGET_CHARS = 60000;

    private final List<ExternalFindingImporter> importers;
    private final FindingContextService findingContextService;
    private final TriageReportService triageReportService;
    private final TriageFeedbackStore feedbackStore;
    private final RuleSuppressionStore suppressionStore;
    private final LlmAdvisoryService advisoryService;
    private final ReviewQueueStore reviewQueueStore;
    private final AgentRunStore runStore;
    private final BuildProperties buildProperties;
    private final VulnStore vulnStore;
    private final Executor executor;
    private final Clock clock;

    /**
     * 创建 SAST 研判 Agent 服务。
     *
     * @param importers             外部报警导入边界
     * @param findingContextService 报警上下文构建服务
     * @param triageReportService   启发式研判服务
     * @param feedbackStore         历史人工反馈存储
     * @param suppressionStore      规则抑制存储
     * @param advisoryService       LLM 辅助复核边界
     * @param reviewQueueStore      审核快照存储
     * @param runStore              Agent 运行存储
     * @param buildProperties       构建版本信息
     * @param vulnStore             平台漏洞记录存储
     * @param executor              Agent 后台执行器
     * @param clock                 运行时钟
     */
    public SastTriageAgentService(
            List<ExternalFindingImporter> importers,
            FindingContextService findingContextService,
            TriageReportService triageReportService,
            TriageFeedbackStore feedbackStore,
            RuleSuppressionStore suppressionStore,
            LlmAdvisoryService advisoryService,
            ReviewQueueStore reviewQueueStore,
            AgentRunStore runStore,
            BuildProperties buildProperties,
            VulnStore vulnStore,
            @Qualifier("agentRunExecutor") Executor executor,
            @Qualifier("agentClock") Clock clock) {
        this.importers = importers;
        this.findingContextService = findingContextService;
        this.triageReportService = triageReportService;
        this.feedbackStore = feedbackStore;
        this.suppressionStore = suppressionStore;
        this.advisoryService = advisoryService;
        this.reviewQueueStore = reviewQueueStore;
        this.runStore = runStore;
        this.buildProperties = buildProperties;
        this.vulnStore = vulnStore;
        this.executor = executor;
        this.clock = clock;
    }

    /**
     * 接受一次 SAST 研判运行并交给后台执行器。
     *
     * @param command 运行输入
     * @return 已持久化的运行；后台执行快时可能已经推进状态
     */
    public AgentRun start(SastTriageAgentCommand command) {
        validate(command);
        AgentRun run = createRun(command.projectId(), "upload:" + command.format().trim().toLowerCase());
        executor.execute(() -> execute(run.id(), command));
        return runStore.get(run.id()).orElse(run);
    }

    /**
     * 从平台已有漏洞记录启动单条 SAST 研判。
     *
     * @param command 运行输入
     * @return 已持久化的运行
     * @throws IllegalArgumentException       漏洞标识为空
     * @throws VulnerabilityNotFoundException 漏洞记录不存在
     */
    public AgentRun start(VulnerabilityTriageAgentCommand command) {
        if (command == null || command.vulnerabilityId() == null || command.vulnerabilityId().isBlank()) {
            throw new IllegalArgumentException("vulnerabilityId is required");
        }
        String vulnerabilityId = command.vulnerabilityId().trim();
        VulnFinding vulnerability = vulnStore.findById(vulnerabilityId)
                .orElseThrow(() -> new VulnerabilityNotFoundException(vulnerabilityId));
        AgentRun run = createRun(vulnerability.projectId(), "vulnerability:" + vulnerability.id());
        executor.execute(() -> execute(run.id(), command, vulnerability));
        return runStore.get(run.id()).orElse(run);
    }

    private AgentRun createRun(String projectId, String inputReference) {
        String now = now();
        AgentRun run = new AgentRun(
                UUID.randomUUID().toString(), projectId.trim(), AgentPlaybook.SAST_TRIAGE, PLAYBOOK_VERSION,
                AgentRunStatus.QUEUED, inputReference, "", "", now, now, "", List.of());
        runStore.create(run);
        return run;
    }

    private void execute(String runId, SastTriageAgentCommand command) {
        int sequence = 1;
        String capability = "IMPORT_FINDINGS";
        String stepStartedAt = now();
        try {
            runStore.transition(runId, AgentRunStatus.RUNNING, "", "", stepStartedAt);
            beginStep(runId, sequence, capability, stepStartedAt);
            ExternalFindingImporter importer = importerFor(command.format());
            int cap = Math.max(1, Math.min(command.maxFindings(), MAX_FINDINGS_PER_RUN));
            List<ExternalFinding> findings = importer.importJson(
                    new ByteArrayInputStream(command.findingsJson().getBytes(StandardCharsets.UTF_8)), cap);
            appendStep(runId, sequence++, capability, AgentStepStatus.COMPLETED,
                    "已导入 " + findings.size() + " 条 " + command.format() + " 报警",
                    findings.stream().map(finding -> "finding:" + finding.fingerprint()).toList(),
                    List.of(), "", stepStartedAt);
            TriageExecutionOptions execution = new TriageExecutionOptions(
                    command.projectId(), command.codeVersion(), command.ruleVersion(), command.budgetChars());
            executePrepared(runId, sequence, execution, findings);
        } catch (RuntimeException e) {
            failRun(runId, sequence, capability, stepStartedAt, e);
        }
    }

    private void execute(String runId, VulnerabilityTriageAgentCommand command, VulnFinding vulnerability) {
        int sequence = 1;
        String capability = "LOAD_VULNERABILITY";
        String stepStartedAt = now();
        try {
            runStore.transition(runId, AgentRunStatus.RUNNING, "", "", stepStartedAt);
            beginStep(runId, sequence, capability, stepStartedAt);
            ExternalFinding finding = toExternalFinding(vulnerability);
            appendStep(runId, sequence++, capability, AgentStepStatus.COMPLETED,
                    "已读取漏洞 " + vulnerability.id() + "，准备单条研判",
                    List.of("vulnerability:" + vulnerability.id(), "finding:" + finding.fingerprint()),
                    List.of(), "", stepStartedAt);
            executePrepared(runId, sequence, new TriageExecutionOptions(
                    vulnerability.projectId(), command.codeVersion(), command.ruleVersion(), command.budgetChars()),
                    List.of(finding));
        } catch (RuntimeException e) {
            failRun(runId, sequence, capability, stepStartedAt, e);
        }
    }

    private void executePrepared(
            String runId, int sequence, TriageExecutionOptions execution, List<ExternalFinding> findings) {
        String capability = "BUILD_CONTEXT";
        String stepStartedAt = now();
        try {
            beginStep(runId, sequence, capability, stepStartedAt);
            ContextPackOptions options = contextOptions(execution);
            List<FindingContext> contexts = new ArrayList<>();
            for (ExternalFinding finding : findings) {
                contexts.add(findingContextService.build(finding, options));
            }
            List<String> contextReferences = contexts.stream()
                    .flatMap(context -> context.pack().evidence().stream()
                            .map(evidence -> "finding:" + context.finding().fingerprint()
                                    + "#" + evidence.citationId()))
                    .toList();
            List<String> contextMissing = contexts.stream()
                    .flatMap(context -> context.pack().omittedReasons().stream())
                    .distinct()
                    .toList();
            appendStep(runId, sequence++, capability, AgentStepStatus.COMPLETED,
                    "已为 " + contexts.size() + " 条报警构建可引用上下文",
                    contextReferences, contextMissing, "", stepStartedAt);

            capability = "TRIAGE_FINDINGS";
            stepStartedAt = now();
            beginStep(runId, sequence, capability, stepStartedAt);
            List<TriageReport> reports = contexts.stream()
                    .map(context -> triageReportService.build(context, reviewContext(execution, context.finding())))
                    .toList();
            List<String> triageMissing = reports.stream()
                    .flatMap(report -> report.missingInfo().stream())
                    .distinct()
                    .toList();
            appendStep(runId, sequence++, capability, AgentStepStatus.COMPLETED,
                    "已生成 " + reports.size() + " 条证据化研判结论",
                    reports.stream().map(report -> "finding:" + report.finding().fingerprint()).toList(),
                    triageMissing, "", stepStartedAt);

            capability = "LLM_ADVISORY";
            stepStartedAt = now();
            beginStep(runId, sequence, capability, stepStartedAt);
            List<LlmAdvisoryResult> advisoryResults = reports.stream()
                    .map(advisoryService::review)
                    .toList();
            AgentStepStatus advisoryStepStatus = advisoryStatus(advisoryResults);
            long modelUsed = advisoryResults.stream().filter(LlmAdvisoryResult::modelUsed).count();
            appendStep(runId, sequence++, capability, advisoryStepStatus,
                    advisorySummary(advisoryStepStatus, modelUsed, reports.size()),
                    advisoryReferences(advisoryResults),
                    advisoryResults.stream().flatMap(result -> result.missingInfo().stream()).distinct().toList(),
                    advisoryResults(advisoryResults), advisoryError(advisoryResults), stepStartedAt);

            capability = "SUBMIT_REVIEW";
            stepStartedAt = now();
            beginStep(runId, sequence, capability, stepStartedAt);
            ReportSnapshot snapshot = new ReportSnapshot(
                    UUID.randomUUID().toString(),
                    execution.projectId().trim(),
                    "1",
                    buildProperties.getVersion(),
                    safe(execution.codeVersion()),
                    safe(execution.ruleVersion()),
                    now(),
                    reports);
            int entries = reviewQueueStore.submit(snapshot).size();
            appendStep(runId, sequence, capability, AgentStepStatus.COMPLETED,
                    "已提交 " + entries + " 条结果等待人工审核",
                    List.of("report-snapshot:" + snapshot.id()), List.of(), "", stepStartedAt);
            runStore.transition(runId, AgentRunStatus.WAITING_FOR_REVIEW,
                    "report-snapshot:" + snapshot.id(), "", now());
        } catch (RuntimeException e) {
            failRun(runId, sequence, capability, stepStartedAt, e);
        }
    }

    private TriageReviewContext reviewContext(TriageExecutionOptions execution, ExternalFinding finding) {
        TriageFeedback feedback = feedbackStore
                .findByFingerprint(execution.projectId(), finding.fingerprint())
                .orElse(null);
        RuleSuppression suppression = suppressionStore.findActive(
                        execution.projectId(), finding.ruleId(), finding.filePath(), clock.instant())
                .orElse(null);
        return new TriageReviewContext(
                execution.projectId(), execution.codeVersion(), execution.ruleVersion(), feedback, suppression);
    }

    private ContextPackOptions contextOptions(TriageExecutionOptions execution) {
        GraphRagOptions defaults = GraphRagOptions.defaults();
        GraphRagOptions graphRag = new GraphRagOptions(
                defaults.seedLimit(), defaults.graphDepth(), defaults.callGraph(),
                defaults.impactExpansion(), defaults.rerank(), execution.projectId(),
                defaults.lang(), defaults.noTest());
        int budget = Math.max(MIN_BUDGET_CHARS, Math.min(execution.budgetChars(), MAX_BUDGET_CHARS));
        return new ContextPackOptions("security", budget, graphRag);
    }

    private static ExternalFinding toExternalFinding(VulnFinding vulnerability) {
        String detail = safe(vulnerability.detail()).trim();
        String message = vulnerability.title().trim() + (detail.isEmpty() ? "" : ": " + detail);
        return new ExternalFinding(
                "repograph", vulnerability.ruleId(), vulnerability.cwe(),
                ExternalFindingSeverity.from(vulnerability.severity()),
                message, vulnerability.filePath(), vulnerability.startLine(), vulnerability.startLine(),
                vulnerability.qualifiedName(), List.of(), "");
    }

    private void failRun(
            String runId, int sequence, String capability, String stepStartedAt, RuntimeException error) {
        String message = safeError(error);
        appendStep(runId, sequence, capability, AgentStepStatus.FAILED,
                "步骤执行失败", List.of(), List.of(), message, stepStartedAt);
        AgentRunStatus failureStatus = sequence > 1 ? AgentRunStatus.PARTIAL : AgentRunStatus.FAILED;
        runStore.transition(runId, failureStatus, "", errorCode(capability) + ": " + message, now());
        log.warn("Agent run '{}' failed at {}: {}", runId, capability, message);
    }

    private ExternalFindingImporter importerFor(String format) {
        return importers.stream()
                .filter(importer -> importer.supports(format))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("unsupported format '" + format + "'"));
    }

    private void appendStep(
            String runId, int sequence, String capability, AgentStepStatus status,
            String summary, List<String> evidenceReferences, List<String> missingInfo,
            String error, String startedAt) {
        appendStep(runId, sequence, capability, status, summary, evidenceReferences,
                missingInfo, List.of(), error, startedAt);
    }

    private void appendStep(
            String runId, int sequence, String capability, AgentStepStatus status,
            String summary, List<String> evidenceReferences, List<String> missingInfo,
            List<AgentStepResult> results, String error, String startedAt) {
        runStore.saveStep(new AgentStep(
                stepId(runId, sequence), runId, sequence, capability, status,
                summary, evidenceReferences, missingInfo, results, error, startedAt, now()));
    }

    private void beginStep(String runId, int sequence, String capability, String startedAt) {
        runStore.saveStep(new AgentStep(
                stepId(runId, sequence), runId, sequence, capability, AgentStepStatus.RUNNING,
                runningSummary(capability), List.of(), List.of(), List.of(), "", startedAt, ""));
    }

    private static String stepId(String runId, int sequence) {
        return runId + ":step:" + sequence;
    }

    private static String runningSummary(String capability) {
        return switch (capability) {
            case "IMPORT_FINDINGS" -> "正在解析并归一化外部报警";
            case "LOAD_VULNERABILITY" -> "正在读取平台漏洞事实";
            case "BUILD_CONTEXT" -> "正在定位代码并构建证据上下文";
            case "TRIAGE_FINDINGS" -> "正在生成启发式研判结论";
            case "LLM_ADVISORY" -> "正在请求 LLM 辅助复核";
            case "SUBMIT_REVIEW" -> "正在冻结报告快照并提交人工审核";
            default -> "正在执行步骤";
        };
    }

    private static AgentStepStatus advisoryStatus(List<LlmAdvisoryResult> results) {
        if (results.stream().allMatch(result -> result.status() == LlmAdvisoryStatus.DISABLED)) {
            return AgentStepStatus.SKIPPED;
        }
        if (results.stream().anyMatch(result -> result.status() == LlmAdvisoryStatus.COMPLETED)) {
            return AgentStepStatus.COMPLETED;
        }
        return AgentStepStatus.FAILED;
    }

    private static String advisorySummary(AgentStepStatus status, long modelUsed, int total) {
        return switch (status) {
            case SKIPPED -> "LLM 辅助复核未启用，保留启发式研判结果";
            case COMPLETED -> "LLM 已辅助复核 " + modelUsed + "/" + total
                    + " 条结果，建议仅供人工参考";
            default -> "LLM 辅助复核不可用，已降级保留启发式研判结果";
        };
    }

    private static List<String> advisoryReferences(List<LlmAdvisoryResult> results) {
        return results.stream()
                .filter(result -> result.status() == LlmAdvisoryStatus.COMPLETED)
                .flatMap(result -> result.citations().stream()
                        .map(citation -> "finding:" + result.heuristicReport().finding().fingerprint()
                                + "#" + citation))
                .toList();
    }

    private static List<AgentStepResult> advisoryResults(List<LlmAdvisoryResult> results) {
        return results.stream()
                .filter(result -> result.status() == LlmAdvisoryStatus.COMPLETED)
                .map(result -> new AgentStepResult(
                        "finding:" + result.heuristicReport().finding().fingerprint(),
                        result.heuristicReport().verdict().name(),
                        result.suggestedVerdict() == null ? "" : result.suggestedVerdict().name(),
                        result.uncertainty(),
                        result.advisoryOnly()))
                .toList();
    }

    private static String advisoryError(List<LlmAdvisoryResult> results) {
        return results.stream()
                .map(LlmAdvisoryResult::status)
                .filter(status -> status != LlmAdvisoryStatus.COMPLETED
                        && status != LlmAdvisoryStatus.DISABLED)
                .map(Enum::name)
                .distinct()
                .reduce((left, right) -> left + "," + right)
                .orElse("");
    }

    private static void validate(SastTriageAgentCommand command) {
        if (command == null) {
            throw new IllegalArgumentException("command is required");
        }
        if (command.projectId() == null || command.projectId().isBlank()) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (command.format() == null || command.format().isBlank()) {
            throw new IllegalArgumentException("format is required");
        }
        if (command.findingsJson() == null || command.findingsJson().isBlank()) {
            throw new IllegalArgumentException("findingsJson is required");
        }
    }

    private String now() {
        return clock.instant().toString();
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private static String safeError(RuntimeException error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    private static String errorCode(String capability) {
        return switch (capability) {
            case "LOAD_VULNERABILITY" -> "VULNERABILITY_LOAD_FAILED";
            case "IMPORT_FINDINGS" -> "IMPORT_FAILED";
            case "BUILD_CONTEXT" -> "CONTEXT_FAILED";
            case "TRIAGE_FINDINGS" -> "TRIAGE_FAILED";
            case "LLM_ADVISORY" -> "ADVISORY_FAILED";
            case "SUBMIT_REVIEW" -> "REVIEW_SUBMISSION_FAILED";
            default -> "AGENT_RUN_FAILED";
        };
    }

    private record TriageExecutionOptions(
            String projectId, String codeVersion, String ruleVersion, int budgetChars) {
    }
}
