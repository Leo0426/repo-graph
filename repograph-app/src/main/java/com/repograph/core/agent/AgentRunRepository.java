package com.repograph.core.agent;

import java.util.List;
import java.util.Optional;

/**
 * Agent 运行及公开步骤的持久化边界。
 *
 * @author leolu
 */
public interface AgentRunRepository {

    /**
     * 创建运行。
     *
     * @param run 初始运行
     */
    void create(AgentRun run);

    /**
     * 追加一条步骤记录。
     *
     * @param step 步骤记录
     */
    void appendStep(AgentStep step);

    /**
     * 更新运行状态及输出引用。
     *
     * @param runId           运行标识
     * @param status          目标状态
     * @param outputReference 输出事实引用
     * @param statusReason    状态原因
     * @param occurredAt      状态发生时间
     */
    void transition(String runId, AgentRunStatus status, String outputReference,
                    String statusReason, String occurredAt);

    /**
     * 查询单次运行及其步骤。
     *
     * @param runId 运行标识
     * @return 运行，不存在时为空
     */
    Optional<AgentRun> get(String runId);

    /**
     * 查询项目最近的运行。
     *
     * @param projectId 项目标识
     * @param limit     最大返回数量
     * @return 按创建时间倒序的运行列表
     */
    List<AgentRun> list(String projectId, int limit);
}
