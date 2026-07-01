package com.repograph.core.graph;

import java.util.Map;

/**
 * 单个项目的图谱统计快照，供 dashboard 概览面板使用。
 *
 * <p>所有 {@code Map} 字段均使用 {@link java.util.LinkedHashMap}（保留排序），key 为枚举名或框架名，
 * value 为节点/边计数。项目不存在或为空时返回零计数 + 空 Map，不返回 {@code null}。
 *
 * @param projectId              12 字符 projectId 前缀
 * @param projectRoot            项目根目录（可能为空字符串）
 * @param totalUnits             该项目下 {@code :CodeUnit} 节点总数
 * @param totalFiles             去重后的 {@code filePath} 数量
 * @param totalEdges             该项目下所有出边数量（基于源节点 projectId 过滤）
 * @param entryPointCount        {@code metadata["is_entry_point"]="true"} 的节点数
 * @param testCount              {@code metadata["is_test"]="true"} 的节点数
 * @param kindDistribution       按 {@code kind} 分桶，按计数降序
 * @param languageDistribution   按 {@code language} 分桶，按计数降序
 * @param frameworkDistribution  按 {@code metadata["framework"]} 分桶（仅非空），按计数降序
 * @param edgeKindDistribution   按关系类型（{@code CALLS / EXTENDS / IMPLEMENTS / ...}）分桶，按计数降序
 * @author leolu
 * @since 0.3.0
 */
public record ProjectStats(
        String projectId,
        String projectRoot,
        long totalUnits,
        long totalFiles,
        long totalEdges,
        long entryPointCount,
        long testCount,
        Map<String, Long> kindDistribution,
        Map<String, Long> languageDistribution,
        Map<String, Long> frameworkDistribution,
        Map<String, Long> edgeKindDistribution
) {}
