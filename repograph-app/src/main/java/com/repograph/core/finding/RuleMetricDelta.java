package com.repograph.core.finding;

import java.util.Objects;

/**
 * 单个指标的版本间回归增量。前序快照缺失该指标（分母不存在）时 {@code delta} 为 {@code null}，
 * 不伪造 0 变化。
 *
 * @param metric   指标名：hits / confirmed / falsePositives / needsReview / confirmationRate /
 *                 falsePositiveRate / suppressionRate / noContextRate
 * @param previous 上一份评估快照的指标值，缺失时为 {@code null}
 * @param current  本份评估快照的指标值，缺失时为 {@code null}
 * @param delta    current - previous，任一侧缺失时为 {@code null}
 * @author leolu
 */
public record RuleMetricDelta(String metric, Double previous, Double current, Double delta) {

    public RuleMetricDelta {
        Objects.requireNonNull(metric, "metric must not be null");
    }

    /**
     * 构造回归增量，任一侧指标缺失时 delta 为 {@code null}。
     *
     * @param metric   指标名
     * @param previous 上一份快照值
     * @param current  本份快照值
     * @return 回归增量记录
     */
    public static RuleMetricDelta of(String metric, Double previous, Double current) {
        Double delta = previous == null || current == null ? null : current - previous;
        return new RuleMetricDelta(metric, previous, current, delta);
    }
}
