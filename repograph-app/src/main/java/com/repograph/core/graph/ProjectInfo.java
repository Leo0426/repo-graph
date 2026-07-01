package com.repograph.core.graph;

/**
 * 已索引项目的元信息，用于 {@code GET /api/v1/projects} 返回，以及 dashboard 项目选择器。
 *
 * @param projectId   12 字符 projectId 前缀（{@code SHA256(projectRoot)[:12]}）
 * @param projectRoot 索引时的项目根目录绝对路径
 * @param nodeCount   该项目在图中的 CodeUnit 节点数量
 * @param indexedAt   最近一次索引完成时间（ISO-8601 字符串），未知时为空字符串
 * @author leolu
 * @since 0.2.0
 */
public record ProjectInfo(
        String projectId,
        String projectRoot,
        long nodeCount,
        String indexedAt
) {
    /**
     * 从 {@code projectRoot} 末段派生人类可读的项目名称，用于 UI 显示和搜索。
     * 根目录未知时回退到 {@code projectId} 前缀。
     */
    public String projectName() {
        if (projectRoot == null || projectRoot.isBlank()) return projectId;
        java.nio.file.Path p = java.nio.file.Path.of(projectRoot);
        java.nio.file.Path name = p.getFileName();
        return name != null ? name.toString() : projectId;
    }
}
