package com.repograph.core.finding;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 规则效果评估的输入事实集合。所有事实由调用方从既有存储收集，评估本身是纯函数，不访问
 * 数据库或文件系统。
 *
 * @param ruleId                      规则标识
 * @param version                     评估的规则注册版本
 * @param projectId                   项目标识（评估范围）
 * @param hits                        该规则的命中事实（实现按指纹去重）
 * @param feedbackByFingerprint       命中指纹到人工反馈状态的映射，缺失项视为未复核
 * @param suppressions                项目内全部抑制策略（实现按 ruleId / active / 过期再过滤）
 * @param contextMissingFingerprints  研判报告上下文定位失败的命中指纹集合
 * @param previous                    上一份评估报告，用于计算版本间回归；首次评估为 {@code null}
 * @param generatedAt                 评估生成时间（ISO-8601），同时作为抑制过期判断的"当前时间"
 * @author leolu
 */
public record RuleEvaluationRequest(
        String ruleId,
        int version,
        String projectId,
        List<RuleEvaluationHit> hits,
        Map<String, TriageFeedbackStatus> feedbackByFingerprint,
        List<RuleSuppression> suppressions,
        Set<String> contextMissingFingerprints,
        RuleEvaluationReport previous,
        String generatedAt) {

    public RuleEvaluationRequest {
        if (ruleId == null || ruleId.isBlank()) {
            throw new IllegalArgumentException("ruleId must not be blank");
        }
        if (projectId == null || projectId.isBlank()) {
            throw new IllegalArgumentException("projectId must not be blank");
        }
        hits = List.copyOf(hits);
        feedbackByFingerprint = Map.copyOf(feedbackByFingerprint);
        suppressions = List.copyOf(suppressions);
        contextMissingFingerprints = Set.copyOf(contextMissingFingerprints);
        if (generatedAt == null || generatedAt.isBlank()) {
            throw new IllegalArgumentException("generatedAt must not be blank");
        }
    }
}
