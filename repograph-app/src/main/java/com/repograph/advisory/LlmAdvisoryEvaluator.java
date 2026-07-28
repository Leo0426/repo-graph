package com.repograph.advisory;

import com.repograph.core.advisory.LabeledAdvisorySample;
import com.repograph.core.advisory.LlmAdvisoryEvaluation;
import com.repograph.core.advisory.LlmAdvisoryStatus;

import java.util.List;

/**
 * 在人工标注的固定样本集上比较启发式基线和模型建议。
 *
 * @author leolu
 */
public class LlmAdvisoryEvaluator {

    /**
     * 计算准确率、延迟和成本指标。
     *
     * @param samples 固定标注样本
     * @return 评估摘要
     */
    public LlmAdvisoryEvaluation evaluate(List<LabeledAdvisorySample> samples) {
        List<LabeledAdvisorySample> immutable = List.copyOf(samples);
        int heuristicCorrect = (int) immutable.stream()
                .filter(sample -> sample.heuristicReport().verdict() == sample.expectedVerdict())
                .count();
        List<LabeledAdvisorySample> available = immutable.stream()
                .filter(sample -> sample.advisoryResult().status() == LlmAdvisoryStatus.COMPLETED)
                .filter(sample -> sample.advisoryResult().suggestedVerdict() != null)
                .toList();
        int advisoryCorrect = (int) available.stream()
                .filter(sample -> sample.advisoryResult().suggestedVerdict() == sample.expectedVerdict())
                .count();
        double averageLatency = available.stream()
                .mapToLong(sample -> sample.advisoryResult().latencyMs())
                .average()
                .orElse(0.0d);
        double totalCost = available.stream()
                .mapToDouble(sample -> sample.advisoryResult().usage().estimatedCostUsd())
                .sum();
        return new LlmAdvisoryEvaluation(
                immutable.size(),
                heuristicCorrect,
                ratio(heuristicCorrect, immutable.size()),
                available.size(),
                advisoryCorrect,
                ratio(advisoryCorrect, available.size()),
                averageLatency,
                totalCost);
    }

    private static double ratio(int numerator, int denominator) {
        return denominator == 0 ? 0.0d : (double) numerator / denominator;
    }
}
