package com.repograph.core.finding;

/**
 * 项目删除时清理研判反馈、规则抑制和审计数据的边界。
 *
 * @author leolu
 */
public interface TriageDataCleanup {

    /**
     * 删除指定项目的全部研判策略数据。
     *
     * @param projectId 项目标识
     */
    void removeProject(String projectId);
}
