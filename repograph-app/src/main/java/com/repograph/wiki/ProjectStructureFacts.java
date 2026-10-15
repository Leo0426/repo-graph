package com.repograph.wiki;

import com.repograph.metrics.ComplexityMetric;

import java.util.List;

/**
 * 项目级结构事实快照，分层摘要生成的唯一输入。
 *
 * <p>所有字段来自图查询与指标事实源（GraphDiagnosticsService / ComplexityAnalyzer），
 * 本类型只是聚合视图，不复制事实所有权。
 *
 * @param projectId      项目标识
 * @param unitCount      项目内可检索单元总数
 * @param entryPointCount入口点单元总数
 * @param deadCodeCount  疑似死代码单元数（图拓扑启发式）
 * @param crossPackageEdgeCount 跨包调用边总数
 * @param packages       包级事实列表，按入度降序排列
 * @param complexityTop  圈复杂度最高的单元（最多 200 个，按复杂度降序）
 * @author leolu
 * @since 0.7.0
 */
public record ProjectStructureFacts(
        String projectId,
        int unitCount,
        int entryPointCount,
        int deadCodeCount,
        int crossPackageEdgeCount,
        List<PackageFacts> packages,
        List<ComplexityMetric> complexityTop
) {

    public ProjectStructureFacts {
        if (packages == null) packages = List.of();
        if (complexityTop == null) complexityTop = List.of();
        packages = List.copyOf(packages);
        complexityTop = List.copyOf(complexityTop);
    }
}
