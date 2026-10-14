package com.repograph.core.finding;

import java.util.List;

/**
 * 单条已发布规则版本的效果评估报告。{@code regression} 为与上一份快照的逐指标增量，首次评估
 * 为空列表；{@code omittedReasons} 记录评估中显式缺失的事实（如零命中、抑制过期时间不可解析），
 * 不把缺失伪装为 0 值结论。
 *
 * @param ruleId         规则标识
 * @param version        评估的规则注册版本
 * @param projectId      项目标识
 * @param metrics        六类指标集合
 * @param regression     与上一份快照的指标回归增量，首次评估为空
 * @param omittedReasons 评估中显式缺失的事实说明
 * @param generatedAt    评估生成时间（ISO-8601）
 * @author leolu
 */
public record RuleEvaluationReport(
        String ruleId,
        int version,
        String projectId,
        RuleMetricSet metrics,
        List<RuleMetricDelta> regression,
        List<String> omittedReasons,
        String generatedAt) {

    public RuleEvaluationReport {
        List.copyOf(regression);
        List.copyOf(omittedReasons);
    }
}
