package com.repograph.metrics;

import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 类级别耦合度分析器。
 *
 * <p>基于 Neo4j 调用图中的 {@code CALLS} 边，计算每个类的传入耦合（fan-in）和
 * 传出耦合（fan-out），并按 Robert Martin 公式计算不稳定性系数。
 *
 * <p>只统计跨类调用，同类内部调用不计入。结果为启发式近似，反射调用等动态场景不可见。
 *
 * @author leolu
 * @since 0.6.0
 */
@Service
public class CouplingAnalyzer {

    private final GraphDiagnosticsService graphQueryService;

    public CouplingAnalyzer(GraphDiagnosticsService graphQueryService) {
        this.graphQueryService = graphQueryService;
    }

    /**
     * 返回指定项目传出耦合（fan-out）最高的前 {@code limit} 个类。
     *
     * <p>fan-out 高意味着该类依赖许多外部类，属于高不稳定区，适合重点审查。
     *
     * @param projectId 项目唯一标识符
     * @param limit     最大返回数量
     * @return 按 fanOut 降序排列的耦合度指标列表
     */
    public List<CouplingMetric> topByFanOut(String projectId, int limit) {
        return compute(projectId).stream()
                .sorted(Comparator.comparingInt(CouplingMetric::fanOut).reversed()
                        .thenComparing(Comparator.comparingInt(CouplingMetric::fanIn).reversed()))
                .limit(limit)
                .toList();
    }

    /**
     * 返回指定项目传入耦合（fan-in）最高的前 {@code limit} 个类。
     *
     * <p>fan-in 高意味着该类被许多外部类依赖，属于高稳定区，改动影响面大。
     *
     * @param projectId 项目唯一标识符
     * @param limit     最大返回数量
     * @return 按 fanIn 降序排列的耦合度指标列表
     */
    public List<CouplingMetric> topByFanIn(String projectId, int limit) {
        return compute(projectId).stream()
                .sorted(Comparator.comparingInt(CouplingMetric::fanIn).reversed()
                        .thenComparing(Comparator.comparingInt(CouplingMetric::fanOut).reversed()))
                .limit(limit)
                .toList();
    }

    /**
     * 计算所有跨类耦合指标（内部使用）。
     */
    List<CouplingMetric> compute(String projectId) {
        List<ClassEdge> edges = graphQueryService.findClassCallEdges(projectId);

        Map<String, Set<String>> fanOutMap = new HashMap<>(); // 调用方类 → 被调用方类集合（去重）
        Map<String, Set<String>> fanInMap  = new HashMap<>(); // 被调用方类 → 调用方类集合（去重）

        for (ClassEdge edge : edges) {
            fanOutMap.computeIfAbsent(edge.callerClass(), k -> new HashSet<>()).add(edge.calleeClass());
            fanInMap .computeIfAbsent(edge.calleeClass(), k -> new HashSet<>()).add(edge.callerClass());
        }

        Set<String> allClasses = new HashSet<>();
        allClasses.addAll(fanOutMap.keySet());
        allClasses.addAll(fanInMap.keySet());

        return allClasses.stream().map(cls -> {
            int fanIn  = fanInMap .getOrDefault(cls, Set.of()).size();
            int fanOut = fanOutMap.getOrDefault(cls, Set.of()).size();
            double instability = (fanIn + fanOut) == 0 ? 0.0 : (double) fanOut / (fanIn + fanOut);
            return new CouplingMetric(cls, fanIn, fanOut, Math.round(instability * 1000.0) / 1000.0);
        }).toList();
    }
}
