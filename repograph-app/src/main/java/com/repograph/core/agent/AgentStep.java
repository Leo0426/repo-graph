package com.repograph.core.agent;

import java.util.List;

/**
 * Agent 运行中的公开步骤记录，仅保存可审计摘要，不保存模型思维链。
 *
 * @param id                 步骤标识
 * @param runId              所属运行标识
 * @param sequence           在运行中的顺序，从 1 开始
 * @param capability         执行的能力名称
 * @param status             步骤状态
 * @param summary            面向用户的结果摘要
 * @param evidenceReferences 证据或领域事实引用
 * @param missingInfo        缺失信息说明
 * @param results            对领域事实产生的公开决策结果
 * @param error              结构化错误摘要
 * @param startedAt          开始时间，ISO-8601
 * @param finishedAt         完成时间，未完成时为空
 * @author leolu
 */
public record AgentStep(
        String id,
        String runId,
        int sequence,
        String capability,
        AgentStepStatus status,
        String summary,
        List<String> evidenceReferences,
        List<String> missingInfo,
        List<AgentStepResult> results,
        String error,
        String startedAt,
        String finishedAt) {

    /**
     * 创建不可变步骤记录。
     */
    public AgentStep {
        evidenceReferences = evidenceReferences == null ? List.of() : List.copyOf(evidenceReferences);
        missingInfo = missingInfo == null ? List.of() : List.copyOf(missingInfo);
        results = results == null ? List.of() : List.copyOf(results);
    }
}
