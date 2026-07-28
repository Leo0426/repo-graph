package com.repograph.core.advisory;

import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;

/**
 * 离线评估使用的人工标注样本。
 *
 * @param sampleId        样本 ID
 * @param expectedVerdict 人工确认的期望结论
 * @param heuristicReport 启发式报告
 * @param advisoryResult  同一报告的模型建议结果
 * @author leolu
 */
public record LabeledAdvisorySample(
        String sampleId,
        TriageVerdict expectedVerdict,
        TriageReport heuristicReport,
        LlmAdvisoryResult advisoryResult
) {}
