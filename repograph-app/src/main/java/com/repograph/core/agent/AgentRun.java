package com.repograph.core.agent;

import java.util.List;

/**
 * 一次可追踪、可审计的 Agent 工作流运行。
 *
 * @param id              运行标识
 * @param projectId       项目标识
 * @param playbook        工作流类型
 * @param playbookVersion 工作流版本
 * @param status          当前状态
 * @param inputReference  输入事实引用
 * @param outputReference 输出事实引用
 * @param statusReason    失败、部分完成等状态的原因
 * @param createdAt       创建时间，ISO-8601
 * @param updatedAt       最后更新时间，ISO-8601
 * @param completedAt     终止时间，未终止时为空
 * @param steps           按执行顺序排列的公开步骤
 * @author leolu
 */
public record AgentRun(
        String id,
        String projectId,
        AgentPlaybook playbook,
        String playbookVersion,
        AgentRunStatus status,
        String inputReference,
        String outputReference,
        String statusReason,
        String createdAt,
        String updatedAt,
        String completedAt,
        List<AgentStep> steps) {

    /**
     * 创建不可变运行记录。
     */
    public AgentRun {
        steps = steps == null ? List.of() : List.copyOf(steps);
    }
}
