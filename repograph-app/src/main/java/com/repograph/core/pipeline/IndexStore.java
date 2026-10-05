package com.repograph.core.pipeline;

import java.util.function.Supplier;

/**
 * 索引存储协调接口，封装图存储和向量存储的联动删除操作。
 *
 * <p>接口位于 core 包，由 app/pipeline 提供实现，供索引、监听和 API 共享项目级变更边界。
 *
 * @author leolu
 * @since 0.1.0
 */
public interface IndexStore {

    /**
     * 串行执行同一项目的存储变更，防止索引与删除相互覆盖。
     *
     * <p>同一 JVM 内共享此协调边界；同线程可以对同一项目重入。回调返回值和异常原样传递，
     * 异常时也必须释放协调资源。该边界不提供跨存储事务或跨进程互斥。
     *
     * @param projectId 项目唯一标识符，不为 {@code null}
     * @param action 待执行的变更，不为 {@code null}
     * @param <T> 回调结果类型
     * @return 回调结果
     */
    <T> T withProjectMutation(String projectId, Supplier<T> action);

    /**
     * 从图和向量存储中删除指定文件的所有数据。
     *
     * <p>在项目变更边界内先持久化重试标记，再删除图节点、边和向量点。
     * 任一步骤失败均向上抛出并保留重试资格；全部成功后才移除缓存条目。
     *
     * @param filePath  文件相对路径，不为 {@code null}
     * @param projectId 项目唯一标识符，不为 {@code null}
     */
    void removeFile(String filePath, String projectId);

    /**
     * 删除指定项目的所有数据（图节点、向量点、增量缓存条目）。
     *
     * <p>在项目变更边界内先持久化项目删除标记，任一步骤失败均向上抛出并保留标记，
     * 全部成功后才清除标记。项目无数据时幂等返回，不报错。
     *
     * @param projectId 项目唯一标识符，不为 {@code null}
     */
    void removeProject(String projectId);
}
