package com.repograph.api;

import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.finding.RuleSuppression;
import com.repograph.core.finding.RuleSuppressionAuditEvent;
import com.repograph.core.finding.RuleSuppressionScope;
import com.repograph.core.finding.TriageFeedback;
import com.repograph.core.finding.TriageFeedbackStatus;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageReviewContext;
import com.repograph.core.retrieval.ContextPackOptions;
import com.repograph.core.retrieval.GraphRagOptions;
import com.repograph.finding.ExternalFindingImporter;
import com.repograph.finding.FindingContextService;
import com.repograph.finding.RuleSuppressionStore;
import com.repograph.finding.TriageFeedbackStore;
import com.repograph.finding.TriageReportService;
import com.repograph.finding.github.GitHubPrCommentClient;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * SAST 报警研判 REST API：上传外部工具 JSON 生成研判报告，读写人工反馈。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/triage")
public class TriageController {

    private static final int MAX_FINDINGS_PER_REQUEST = 50;
    private static final int MIN_BUDGET_CHARS = 1000;
    private static final int MAX_BUDGET_CHARS = 60000;

    private final List<ExternalFindingImporter> importers;
    private final FindingContextService findingContextService;
    private final TriageReportService triageReportService;
    private final TriageFeedbackStore feedbackStore;
    private final RuleSuppressionStore ruleSuppressionStore;
    private final GitHubPrCommentClient gitHubPrCommentClient;

    /**
     * 创建研判 REST 控制器。
     *
     * @param importers             可用的外部报警导入器
     * @param findingContextService 报警上下文构建服务
     * @param triageReportService   研判报告生成服务
     * @param feedbackStore         反馈存储
     * @param ruleSuppressionStore  规则抑制及审计存储
     * @param gitHubPrCommentClient GitHub PR 评论客户端
     */
    public TriageController(List<ExternalFindingImporter> importers,
                            FindingContextService findingContextService,
                            TriageReportService triageReportService,
                            TriageFeedbackStore feedbackStore,
                            RuleSuppressionStore ruleSuppressionStore,
                            GitHubPrCommentClient gitHubPrCommentClient) {
        this.importers = importers;
        this.findingContextService = findingContextService;
        this.triageReportService = triageReportService;
        this.feedbackStore = feedbackStore;
        this.ruleSuppressionStore = ruleSuppressionStore;
        this.gitHubPrCommentClient = gitHubPrCommentClient;
    }

    /**
     * 上传外部工具报警 JSON，逐条生成研判报告。
     *
     * @param format      报警格式，如 {@code semgrep}、{@code sarif}
     * @param projectId   可选项目 ID，限定检索范围
     * @param codeVersion 当前代码版本；与反馈版本一致时才允许自动复用
     * @param ruleVersion 当前规则版本；与反馈版本一致时才允许自动复用
     * @param budgetChars 单条报告的上下文字符预算
     * @param maxFindings 单次请求最多处理的报警数
     * @param request     HTTP 请求，报警 JSON 从请求输入流读取
     * @return 每条报警的研判报告及 Markdown 渲染
     * @throws IOException 请求体读取失败
     */
    @PostMapping("/report")
    public List<TriageReportResponse> report(
            @RequestParam String format,
            @RequestParam(required = false) String projectId,
            @RequestParam(required = false) String codeVersion,
            @RequestParam(required = false) String ruleVersion,
            @RequestParam(defaultValue = "12000") int budgetChars,
            @RequestParam(defaultValue = "10") int maxFindings,
            HttpServletRequest request) throws IOException {
        return buildReports(
                format, projectId, codeVersion, ruleVersion, budgetChars, maxFindings, request);
    }

    /**
     * 上传外部工具报警 JSON，生成研判报告并合并发布为一条 GitHub PR 评论。
     *
     * @param format      报警格式，如 {@code semgrep}、{@code sarif}
     * @param projectId   可选项目 ID，限定检索范围
     * @param codeVersion 当前代码版本
     * @param ruleVersion 当前规则版本
     * @param budgetChars 单条报告的上下文字符预算
     * @param maxFindings 单次请求最多处理的报警数
     * @param owner       仓库所有者（用户名或组织名）
     * @param repo        仓库名
     * @param prNumber    PR 编号
     * @param request     HTTP 请求，报警 JSON 从请求输入流读取
     * @return 发布结果：评论 URL、报警数与逐条研判报告
     * @throws IOException 请求体读取失败
     */
    @PostMapping("/report/pr")
    public PrCommentResponse reportToPr(
            @RequestParam String format,
            @RequestParam(required = false) String projectId,
            @RequestParam(required = false) String codeVersion,
            @RequestParam(required = false) String ruleVersion,
            @RequestParam(defaultValue = "12000") int budgetChars,
            @RequestParam(defaultValue = "10") int maxFindings,
            @RequestParam String owner,
            @RequestParam String repo,
            @RequestParam int prNumber,
            HttpServletRequest request) throws IOException {
        List<TriageReportResponse> responses = buildReports(
                format, projectId, codeVersion, ruleVersion, budgetChars, maxFindings, request);
        List<TriageReport> reports = responses.stream().map(TriageReportResponse::report).toList();
        String commentUrl = gitHubPrCommentClient.postComment(
                owner, repo, prNumber, triageReportService.toMarkdownSummary(reports));
        return new PrCommentResponse(commentUrl, responses.size(), responses);
    }

    private List<TriageReportResponse> buildReports(
            String format,
            String projectId,
            String codeVersion,
            String ruleVersion,
            int budgetChars,
            int maxFindings,
            HttpServletRequest request) throws IOException {
        ExternalFindingImporter importer = importers.stream()
                .filter(i -> i.supports(format))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "unsupported format '" + format + "', expected one of: semgrep, sarif"));

        int cap = Math.max(1, Math.min(maxFindings, MAX_FINDINGS_PER_REQUEST));
        List<ExternalFinding> findings = importer.importJson(request.getInputStream(), cap);

        GraphRagOptions defaults = GraphRagOptions.defaults();
        GraphRagOptions graphRag = new GraphRagOptions(
                defaults.seedLimit(), defaults.graphDepth(), defaults.callGraph(),
                defaults.impactExpansion(), defaults.rerank(), projectId,
                defaults.lang(), defaults.noTest());
        ContextPackOptions options = new ContextPackOptions(
                "security",
                Math.max(MIN_BUDGET_CHARS, Math.min(budgetChars, MAX_BUDGET_CHARS)),
                graphRag);

        List<TriageReportResponse> responses = new ArrayList<>();
        for (ExternalFinding finding : findings) {
            FindingContext context = findingContextService.build(finding, options);
            TriageReport report;
            if (projectId == null || projectId.isBlank()) {
                report = triageReportService.build(context);
            } else {
                TriageFeedback historicalFeedback = feedbackStore
                        .findByFingerprint(projectId, finding.fingerprint())
                        .orElse(null);
                RuleSuppression suppression = ruleSuppressionStore.findActive(
                                projectId,
                                finding.ruleId(),
                                finding.filePath(),
                                Instant.now())
                        .orElse(null);
                report = triageReportService.build(
                        context,
                        new TriageReviewContext(
                                projectId,
                                codeVersion,
                                ruleVersion,
                                historicalFeedback,
                                suppression));
            }
            responses.add(new TriageReportResponse(
                    finding.fingerprint(), report, triageReportService.toMarkdown(report)));
        }
        return responses;
    }

    /**
     * 写入或覆盖一条研判反馈。
     *
     * @param request 反馈请求
     * @return 持久化后的反馈记录
     */
    @PostMapping("/feedback")
    public TriageFeedback feedback(@RequestBody FeedbackRequest request) {
        TriageFeedback feedback = new TriageFeedback(
                request.fingerprint(),
                request.projectId(),
                TriageFeedbackStatus.parse(request.status()),
                request.reviewer(),
                request.reason(),
                request.codeVersion(),
                request.ruleVersion(),
                Instant.now().toString());
        feedbackStore.upsert(feedback);
        return feedback;
    }

    /**
     * 查询项目的研判反馈列表。
     *
     * @param projectId 项目 ID
     * @param status    可选状态过滤
     * @return 按更新时间降序的反馈列表
     */
    @GetMapping("/feedback")
    public List<TriageFeedback> listFeedback(
            @RequestParam String projectId,
            @RequestParam(required = false) String status) {
        TriageFeedbackStatus filter = status == null || status.isBlank()
                ? null : TriageFeedbackStatus.parse(status);
        return feedbackStore.list(projectId, filter);
    }

    /**
     * 创建有作用域和有效期的规则抑制策略。
     *
     * @param request 策略请求
     * @return 已创建策略
     */
    @PostMapping("/suppressions")
    public RuleSuppression createSuppression(@RequestBody SuppressionRequest request) {
        String now = Instant.now().toString();
        RuleSuppression suppression = new RuleSuppression(
                UUID.randomUUID().toString(),
                request.projectId(),
                request.ruleId(),
                parseSuppressionScope(request.scope()),
                request.scopeValue(),
                request.reason(),
                request.createdBy(),
                now,
                request.expiresAt(),
                true);
        ruleSuppressionStore.create(suppression);
        return suppression;
    }

    /**
     * 查询项目规则抑制策略。
     *
     * @param projectId 项目标识
     * @param ruleId    可选规则标识
     * @return 策略列表
     */
    @GetMapping("/suppressions")
    public List<RuleSuppression> listSuppressions(
            @RequestParam String projectId,
            @RequestParam(required = false) String ruleId) {
        return ruleSuppressionStore.list(projectId, ruleId);
    }

    /**
     * 撤销规则抑制并记录审计事件。
     *
     * @param suppressionId 策略标识
     * @param request       操作人和撤销理由
     * @return 撤销结果
     */
    @PostMapping("/suppressions/{suppressionId}/revoke")
    public org.springframework.http.ResponseEntity<Map<String, String>> revokeSuppression(
            @PathVariable String suppressionId,
            @RequestBody RevokeSuppressionRequest request) {
        boolean revoked = ruleSuppressionStore.revoke(
                suppressionId,
                request.actor(),
                request.reason(),
                Instant.now().toString());
        if (!revoked) {
            return org.springframework.http.ResponseEntity.notFound().build();
        }
        return org.springframework.http.ResponseEntity.ok(
                Map.of("id", suppressionId, "status", "REVOKED"));
    }

    /**
     * 查询规则抑制的审计记录。
     *
     * @param suppressionId 策略标识
     * @return 审计事件
     */
    @GetMapping("/suppressions/{suppressionId}/audit")
    public List<RuleSuppressionAuditEvent> suppressionAudit(
            @PathVariable String suppressionId) {
        return ruleSuppressionStore.audit(suppressionId);
    }

    /**
     * 单条报警的研判响应。
     *
     * @param fingerprint 报警指纹，用于后续反馈关联
     * @param report      研判报告
     * @param markdown    可直接粘贴到 issue / PR 评论的 Markdown 渲染
     */
    public record TriageReportResponse(String fingerprint, TriageReport report, String markdown) {}

    /**
     * PR 评论发布结果。
     *
     * @param commentUrl    GitHub 返回的评论网页 URL
     * @param findingsCount 本次研判的报警数
     * @param reports       逐条研判报告，同 {@link #report}
     */
    public record PrCommentResponse(String commentUrl, int findingsCount, List<TriageReportResponse> reports) {}

    /**
     * 反馈写入请求。
     *
     * @param fingerprint 报警指纹
     * @param projectId   项目 ID
     * @param status      反馈状态字符串
     * @param reviewer    反馈人
     * @param reason      反馈理由
     * @param codeVersion 反馈对应的代码版本
     * @param ruleVersion 反馈对应的规则版本
     */
    public record FeedbackRequest(String fingerprint, String projectId, String status,
                                  String reviewer, String reason,
                                  String codeVersion, String ruleVersion) {}

    /**
     * 规则抑制创建请求。
     *
     * @param projectId  项目标识
     * @param ruleId     规则标识
     * @param scope      PROJECT 或 FILE_GLOB
     * @param scopeValue FILE_GLOB 的 glob
     * @param reason     创建理由
     * @param createdBy  创建人
     * @param expiresAt  过期时间
     */
    public record SuppressionRequest(
            String projectId,
            String ruleId,
            String scope,
            String scopeValue,
            String reason,
            String createdBy,
            String expiresAt
    ) {}

    /**
     * 规则抑制撤销请求。
     *
     * @param actor  操作人
     * @param reason 撤销理由
     */
    public record RevokeSuppressionRequest(String actor, String reason) {}

    private static RuleSuppressionScope parseSuppressionScope(String scope) {
        if (scope == null || scope.isBlank()) {
            throw new IllegalArgumentException("scope must be PROJECT or FILE_GLOB");
        }
        try {
            return RuleSuppressionScope.valueOf(scope.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(
                    "scope must be PROJECT or FILE_GLOB, got '" + scope + "'", e);
        }
    }
}
