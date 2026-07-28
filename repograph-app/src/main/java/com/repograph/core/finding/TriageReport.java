package com.repograph.core.finding;

import com.repograph.core.retrieval.ContextPack;

import java.util.List;

/**
 * 单条外部报警的研判报告，结论仅基于上下文包中的可引用证据得出。
 *
 * @param finding              被研判的外部报警
 * @param located              是否定位到报警所在代码单元
 * @param locatedQualifiedName 定位到的代码单元全限定名；未定位到时为空字符串
 * @param verdict              初步结论
 * @param confidence           结论置信度 [0, 1]
 * @param reasons              支撑结论的理由，引用证据 citation ID
 * @param missingInfo          影响结论可靠性的缺失信息
 * @param remediation          修复建议
 * @param developerSummary     面向研发的一段式解释
 * @param pack                 证据链上下文包
 * @param decisionEvidence     历史反馈、规则策略和路径一致性等决策证据
 * @author leolu
 */
public record TriageReport(
        ExternalFinding finding,
        boolean located,
        String locatedQualifiedName,
        TriageVerdict verdict,
        float confidence,
        List<String> reasons,
        List<String> missingInfo,
        String remediation,
        String developerSummary,
        ContextPack pack,
        List<TriageDecisionEvidence> decisionEvidence
) {
    /**
     * 创建不带额外决策证据的兼容报告。
     *
     * @param finding              被研判报警
     * @param located              是否定位
     * @param locatedQualifiedName 定位符号
     * @param verdict              结论
     * @param confidence           置信度
     * @param reasons              理由
     * @param missingInfo          缺失信息
     * @param remediation          修复建议
     * @param developerSummary     研发摘要
     * @param pack                 上下文包
     */
    public TriageReport(
            ExternalFinding finding,
            boolean located,
            String locatedQualifiedName,
            TriageVerdict verdict,
            float confidence,
            List<String> reasons,
            List<String> missingInfo,
            String remediation,
            String developerSummary,
            ContextPack pack) {
        this(finding, located, locatedQualifiedName, verdict, confidence, reasons,
                missingInfo, remediation, developerSummary, pack, List.of());
    }

    /**
     * 创建不可变研判报告。
     */
    public TriageReport {
        reasons = List.copyOf(reasons);
        missingInfo = List.copyOf(missingInfo);
        decisionEvidence = List.copyOf(decisionEvidence);
    }
}
