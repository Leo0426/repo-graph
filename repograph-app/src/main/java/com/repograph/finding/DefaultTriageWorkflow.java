package com.repograph.finding;

import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.finding.TriageOptions;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageReviewContext;
import com.repograph.core.finding.TriageWorkflow;
import com.repograph.core.retrieval.ContextPackOptions;
import com.repograph.core.retrieval.GraphRagOptions;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.time.Clock;
import java.util.List;

/**
 * 统一导入限额、证据预算、版本反馈和规则抑制的研判应用流程。
 *
 * @author leolu
 */
@Service
public class DefaultTriageWorkflow implements TriageWorkflow {
    private final List<ExternalFindingImporter> importers;
    private final FindingContextService contexts;
    private final TriageReportService reports;
    private final TriageFeedbackStore feedback;
    private final RuleSuppressionStore suppressions;
    private final Clock clock;

    /**
     * 创建共享研判流程。
     * @param importers 格式适配器
     * @param contexts 证据构建
     * @param reports 启发式判断
     * @param feedback 历史反馈
     * @param suppressions 有效抑制查询
     * @param clock 决策时间
     */
    public DefaultTriageWorkflow(List<ExternalFindingImporter> importers, FindingContextService contexts,
                                 TriageReportService reports, TriageFeedbackStore feedback,
                                 RuleSuppressionStore suppressions, @Qualifier("agentClock") Clock clock) {
        this.importers = List.copyOf(importers);
        this.contexts = contexts;
        this.reports = reports;
        this.feedback = feedback;
        this.suppressions = suppressions;
        this.clock = clock;
    }

    /** {@inheritDoc} */
    @Override
    public List<ExternalFinding> importFindings(String format, InputStream input, int maxFindings) {
        ExternalFindingImporter importer = importers.stream().filter(candidate -> candidate.supports(format))
                .findFirst().orElseThrow(() -> new IllegalArgumentException("unsupported format '" + format + "'"));
        return importer.importJson(input, Math.max(1, Math.min(maxFindings, 50)));
    }

    /** {@inheritDoc} */
    @Override
    public FindingContext buildContext(ExternalFinding finding, TriageOptions options) {
        GraphRagOptions defaults = GraphRagOptions.defaults();
        GraphRagOptions graph = new GraphRagOptions(defaults.seedLimit(), defaults.graphDepth(),
                defaults.callGraph(), defaults.impactExpansion(), defaults.rerank(), options.projectId(),
                defaults.lang(), defaults.noTest());
        return contexts.build(finding, new ContextPackOptions("security", options.budgetChars(), graph));
    }

    /** {@inheritDoc} */
    @Override
    public TriageReport review(FindingContext context, TriageOptions options) {
        if (options.projectId().isBlank()) {
            return reports.build(context);
        }
        ExternalFinding finding = context.finding();
        TriageReviewContext review = new TriageReviewContext(options.projectId(), options.codeVersion(),
                options.ruleVersion(), feedback.findByFingerprint(options.projectId(), finding.fingerprint())
                        .orElse(null),
                suppressions.findActive(options.projectId(), finding.ruleId(), finding.filePath(), clock.instant())
                        .orElse(null));
        return reports.build(context, review);
    }
}
