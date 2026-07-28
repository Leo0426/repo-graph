package com.repograph.core.advisory;

/**
 * 固定标注集上的 LLM 辅助复核评估摘要。
 *
 * @param sampleCount             总样本数
 * @param heuristicCorrect        启发式结论正确数
 * @param heuristicAccuracy       启发式准确率
 * @param advisoryAvailable       有可用模型建议的样本数
 * @param advisoryCorrect         模型建议正确数
 * @param advisoryAccuracy        模型建议准确率
 * @param averageLatencyMs        可用模型建议平均延迟
 * @param totalEstimatedCostUsd   总估算美元成本
 * @author leolu
 */
public record LlmAdvisoryEvaluation(
        int sampleCount,
        int heuristicCorrect,
        double heuristicAccuracy,
        int advisoryAvailable,
        int advisoryCorrect,
        double advisoryAccuracy,
        double averageLatencyMs,
        double totalEstimatedCostUsd
) {}
