package com.repograph.core.finding;

/**
 * 单条规则效果评估的六类指标集合。比率字段为 {@code null} 表示分母不存在（例如零命中或无
 * 明确人工结论），不输出 0% 假结论。
 *
 * @param hits               命中数：评估范围内该规则的去重报警指纹数
 * @param confirmed          确认数：人工反馈 {@code TRUE_POSITIVE} + {@code FIXED}
 * @param falsePositives     误报数：人工反馈 {@code FALSE_POSITIVE}
 * @param needsReview        待复核数：人工反馈 {@code NEEDS_REVIEW}，不进入确认/误报分母
 * @param confirmationRate   确认率：confirmed / (confirmed + falsePositives)，分母不存在时为 {@code null}
 * @param falsePositiveRate  误报率：falsePositives / (confirmed + falsePositives)，分母不存在时为 {@code null}
 * @param suppressionRate    抑制率：命中中路径匹配 active 且未过期抑制策略的比例，零命中时为 {@code null}
 * @param noContextRate      无上下文率：命中中研判报告上下文定位失败的比例，零命中时为 {@code null}
 * @author leolu
 */
public record RuleMetricSet(
        int hits,
        int confirmed,
        int falsePositives,
        int needsReview,
        Double confirmationRate,
        Double falsePositiveRate,
        Double suppressionRate,
        Double noContextRate) {
}
