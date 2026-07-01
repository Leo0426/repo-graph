package com.repograph.core.pipeline;

/**
 * 索引存储协调接口，封装图存储和向量存储的联动删除操作。
 *
 * <p>实现由 repograph-app 模块的 {@code DefaultIndexStore} 提供。接口住在 repograph-core 是为了让
 * repograph-api 等不依赖 repograph-app 的模块也能通过此接口触发删除。
 *
 * @author leolu
 * @since 0.1.0
 */
public interface IndexStore {

    /**
     * 从图和向量存储中删除指定文件的所有数据（best-effort 协调）。
     *
     * <p>先删除图节点和边，再删除向量点。图删除失败时向上抛出；
     * 向量删除失败时记录 WARN 日志并继续，不影响后续索引流程。
     *
     * @param filePath  文件相对路径，不为 {@code null}
     * @param projectId 项目唯一标识符，不为 {@code null}
     */
    void removeFile(String filePath, String projectId);

    /**
     * 删除指定项目的所有数据（图节点、向量点、增量缓存条目）。
     *
     * <p>best-effort 协调：图删除失败抛出；向量和缓存删除失败仅 WARN。
     * 项目无数据时幂等返回，不报错。
     *
     * @param projectId 项目唯一标识符，不为 {@code null}
     */
    void removeProject(String projectId);
}
