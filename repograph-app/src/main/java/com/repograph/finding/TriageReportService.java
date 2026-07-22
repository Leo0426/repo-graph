package com.repograph.finding;

import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
import com.repograph.core.retrieval.ContextEvidence;
import com.repograph.core.retrieval.ContextPack;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import static com.repograph.finding.ProtectionSignalDetector.ProtectionSignal;

/**
 * 报警研判报告生成服务，基于 {@link FindingContext} 的证据链输出结论、置信度与修复建议。
 *
 * <p>当前为不依赖 LLM 的启发式基线：结论只由可引用证据推导（定位是否成功、定位单元的
 * 安全信号、调用方可达性），不做无证据的推断；证据不足时输出 {@code NEEDS_REVIEW}
 * 并列出缺失信息。后续接入 LLM 时该服务的输出可作为提示词中的结构化事实。
 *
 * @author leolu
 */
@Service
public class TriageReportService {

    private static final Map<String, String> CWE_REMEDIATIONS = Map.of(
            "CWE-78", "避免拼接外部输入构造命令；使用 ProcessBuilder 参数列表等参数化 API，并对输入做白名单校验。",
            "CWE-89", "使用 PreparedStatement 等参数化查询，禁止字符串拼接 SQL；对动态表名/列名做白名单映射。",
            "CWE-79", "对输出做上下文相关编码，启用模板引擎自动转义；富文本输入使用白名单过滤。",
            "CWE-22", "对路径做规范化（canonicalize）后校验其位于允许目录内；拒绝包含 `..` 的输入。",
            "CWE-502", "不要反序列化不可信数据；如必须，使用类白名单过滤或改用 JSON 等数据格式。"
    );

    /**
     * 基于报警上下文生成研判报告。
     *
     * @param context 报警研判上下文，不为 {@code null}
     * @return 研判报告
     */
    public TriageReport build(FindingContext context) {
        ExternalFinding finding = context.finding();
        ContextPack pack = context.pack();
        List<String> reasons = new ArrayList<>();
        List<String> missing = new ArrayList<>();

        ContextEvidence location = pack.evidence().stream()
                .filter(e -> "FINDING".equals(e.source()))
                .findFirst().orElse(null);
        long callers = pack.evidence().stream()
                .filter(e -> "CALLER".equals(e.relation()))
                .count();
        List<String> signals = location != null ? location.securitySignals() : List.of();
        // 框架入口点（HTTP handler 等）的真正调用方是外部请求，天然不会出现在仓库内的调用图里；
        // 把"仓库内调用方数量"当作唯一可达性证据会系统性误判所有入口点自身的敏感操作。
        boolean isEntryPoint = signals.contains("entry_point");
        boolean reachable = callers > 0 || isEntryPoint;
        List<ProtectionSignal> protections = ProtectionSignalDetector.detect(finding, pack.evidence());

        TriageVerdict verdict;
        float confidence;
        if (location == null) {
            verdict = TriageVerdict.NEEDS_REVIEW;
            confidence = 0.2f;
            missing.add("报警位置未被索引: " + finding.filePath() + ":" + finding.startLine()
                    + "，无法确认代码上下文");
            reasons.add("无法定位报警所在代码单元，仅有关键词证据可供参考");
        } else {
            reasons.add("报警定位到 [" + location.citationId() + "] " + location.qualifiedName()
                    + "（" + location.filePath() + ":" + location.startLine() + "-" + location.endLine() + "）");
            String reachabilityReason = callers > 0
                    ? "发现 " + callers + " 个调用方，报警代码在调用图中可达"
                    : "定位单元本身是框架识别的入口点（entry_point），视为可从外部请求直接触达";
            if (!signals.isEmpty() && reachable && !protections.isEmpty()) {
                verdict = TriageVerdict.NEEDS_REVIEW;
                confidence = 0.65f;
                reasons.add("定位单元存在安全信号: " + String.join(", ", signals));
                reasons.add(reachabilityReason);
                protections.forEach(protection -> reasons.add("[" + protection.citationId() + "] 发现候选防护: "
                        + protection.description() + "；需确认其是否覆盖报警数据流"));
                missing.add("已发现防护代码，但尚未验证该防护是否支配 sink "
                        + "且覆盖所有输入路径");
            } else if (!signals.isEmpty() && reachable) {
                verdict = TriageVerdict.TRUE_RISK;
                confidence = Math.min(0.9f, 0.5f + 0.1f * signals.size() + 0.05f * callers);
                reasons.add("定位单元存在安全信号: " + String.join(", ", signals));
                reasons.add(reachabilityReason);
            } else if (signals.isEmpty() && !reachable) {
                verdict = TriageVerdict.LIKELY_FALSE_POSITIVE;
                confidence = 0.6f;
                reasons.add("定位单元无安全信号，且未发现任何调用方，缺少可达性与敏感操作证据");
            } else {
                verdict = TriageVerdict.NEEDS_REVIEW;
                confidence = 0.5f;
                if (signals.isEmpty()) {
                    reasons.add("定位单元无安全信号，但存在 " + callers + " 个调用方，需人工确认是否触及敏感操作");
                } else {
                    reasons.add("定位单元存在安全信号（" + String.join(", ", signals)
                            + "），但既非框架入口点也未发现调用方，需人工确认入口可达性");
                }
            }
        }

        if (finding.trace().isEmpty()) {
            missing.add("外部工具未提供数据流 trace，无法直接验证 source → sink 路径");
        }
        if (pack.evidence().stream().anyMatch(ContextEvidence::truncated)) {
            missing.add("部分证据片段因字符预算被截断，结论可能遗漏截断部分的防护代码");
        }

        String remediation = CWE_REMEDIATIONS.getOrDefault(finding.cwe(),
                "参照规则 " + finding.ruleId() + " 的官方说明，结合证据链中定位代码修复；"
                        + "无法立即修复时优先补充输入校验并收敛调用入口。");
        String developerSummary = buildDeveloperSummary(finding, verdict, location, callers, !protections.isEmpty());

        return new TriageReport(finding, context.located(), context.locatedQualifiedName(),
                verdict, confidence, List.copyOf(reasons), List.copyOf(missing),
                remediation, developerSummary, pack);
    }

    /**
     * 将多条研判报告合并渲染为单条 PR / issue 评论：置信度统计概览 + 每条报告的可折叠详情，
     * 避免每条报警各发一条评论造成刷屏。
     *
     * @param reports 研判报告列表，不为 {@code null}；为空时返回"无报警"提示
     * @return Markdown 文本
     */
    public String toMarkdownSummary(List<TriageReport> reports) {
        StringBuilder md = new StringBuilder();
        md.append("## RepoGraph SAST 报警研判\n\n");
        if (reports.isEmpty()) {
            md.append("本次未发现可研判的报警。\n");
            return md.toString();
        }

        Map<TriageVerdict, Long> counts = new EnumMap<>(TriageVerdict.class);
        for (TriageReport report : reports) {
            counts.merge(report.verdict(), 1L, Long::sum);
        }
        md.append("**").append(reports.size()).append(" 条报警**：");
        md.append(counts.entrySet().stream()
                .map(e -> e.getKey() + " × " + e.getValue())
                .reduce((a, b) -> a + " · " + b).orElse(""));
        md.append("\n\n");

        for (TriageReport report : reports) {
            ExternalFinding finding = report.finding();
            md.append("<details>\n<summary>[").append(report.verdict()).append("] ")
                    .append(finding.ruleId()).append(" — `").append(finding.filePath())
                    .append(':').append(finding.startLine()).append("`</summary>\n\n");
            md.append(toMarkdown(report));
            md.append("\n</details>\n\n");
        }
        return md.toString();
    }

    /**
     * 将研判报告渲染为可直接粘贴到 issue / PR 评论的 Markdown。
     *
     * @param report 研判报告
     * @return Markdown 文本
     */
    public String toMarkdown(TriageReport report) {
        ExternalFinding finding = report.finding();
        StringBuilder md = new StringBuilder();
        md.append("## [").append(finding.tool()).append("] ").append(finding.ruleId())
                .append(" — ").append(report.verdict())
                .append(String.format("（置信度 %.2f）", report.confidence())).append('\n').append('\n');
        md.append("**位置**: `").append(finding.filePath()).append(':').append(finding.startLine()).append('`');
        if (report.located()) {
            md.append("（`").append(report.locatedQualifiedName()).append("`）");
        }
        md.append('\n');
        if (!finding.cwe().isBlank()) {
            md.append("**CWE**: ").append(finding.cwe()).append(" | ");
        }
        md.append("**严重程度**: ").append(finding.severity()).append('\n').append('\n');
        md.append("> ").append(finding.message()).append('\n').append('\n');

        md.append("### 研判结论\n\n").append(report.developerSummary()).append('\n').append('\n');
        for (String reason : report.reasons()) {
            md.append("- ").append(reason).append('\n');
        }
        md.append('\n');

        md.append("### 证据\n\n");
        if (report.pack().evidence().isEmpty()) {
            md.append("（无可引用证据）\n");
        }
        for (ContextEvidence e : report.pack().evidence()) {
            md.append("- [").append(e.citationId()).append("] `").append(e.qualifiedName())
                    .append("`（`").append(e.filePath()).append(':').append(e.startLine())
                    .append('-').append(e.endLine()).append("`，").append(e.source())
                    .append('/').append(e.relation()).append("）\n");
        }
        md.append('\n');

        if (!report.missingInfo().isEmpty()) {
            md.append("### 缺失信息\n\n");
            for (String info : report.missingInfo()) {
                md.append("- ").append(info).append('\n');
            }
            md.append('\n');
        }

        md.append("### 修复建议\n\n").append(report.remediation()).append('\n');
        return md.toString();
    }

    private static String buildDeveloperSummary(ExternalFinding finding, TriageVerdict verdict,
                                                ContextEvidence location, long callers, boolean protectionDetected) {
        String where = location != null
                ? "`" + location.qualifiedName() + "`"
                : "`" + finding.filePath() + ":" + finding.startLine() + "`（未被索引）";
        return switch (verdict) {
            case TRUE_RISK -> "该报警大概率是真实风险：" + where + " 存在安全敏感操作且有 "
                    + callers + " 个调用方可达，建议按修复建议处理并补充回归测试。";
            case LIKELY_FALSE_POSITIVE -> "该报警倾向误报：" + where
                    + " 未发现安全敏感信号，也没有调用方触达该代码，可在人工快速复核后关闭。";
            case NEEDS_REVIEW -> protectionDetected
                    ? "该报警需要人工确认：" + where + " 同时存在敏感操作与候选防护，"
                    + "需验证防护是否覆盖报警数据流和所有入口。"
                    : "该报警需要人工确认：现有证据不足以判断 " + where
                    + " 的真实风险，请结合缺失信息一节补充上下文。";
        };
    }
}
