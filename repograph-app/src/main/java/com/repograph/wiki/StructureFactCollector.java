package com.repograph.wiki;

import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import com.repograph.metrics.ComplexityAnalyzer;
import com.repograph.metrics.ComplexityMetric;
import com.repograph.metrics.PackageCycleDetector;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 结构事实收集器：从图查询与指标事实源聚合分层摘要所需的确定性输入。
 *
 * <p>对应 DeepMap 借鉴设计的 Phase 1（结构卡事实收集，无 LLM）。只消费
 * GraphDiagnosticsService / ComplexityAnalyzer，不复制指标事实源；单次查询结果
 * 有限额保护（listSearchTargets 上限 20000，复杂度 top 200）。
 *
 * @author leolu
 * @since 0.7.0
 */
@Service
public class StructureFactCollector {

    private static final int MAX_UNITS = 20000;
    private static final int MAX_COMPLEXITY = 200;
    private static final int MAX_KEY_SYMBOLS = 5;

    private final GraphDiagnosticsService diagnostics;
    private final ComplexityAnalyzer complexityAnalyzer;

    public StructureFactCollector(GraphDiagnosticsService diagnostics,
                                  ComplexityAnalyzer complexityAnalyzer) {
        this.diagnostics = diagnostics;
        this.complexityAnalyzer = complexityAnalyzer;
    }

    /**
     * 收集项目结构事实。
     *
     * @param projectId 项目唯一标识符
     * @return 结构事实；项目未索引时 unitCount 为 0
     */
    public ProjectStructureFacts collect(String projectId) {
        List<CodeUnit> units = diagnostics.listSearchTargets(projectId, null, null, false, MAX_UNITS);

        int entryPointCount = 0;
        // 包名 → 包内类/单元
        Map<String, List<CodeUnit>> byPkg = new LinkedHashMap<>();
        for (CodeUnit unit : units) {
            String pkg = pkgOf(unit);
            byPkg.computeIfAbsent(pkg, k -> new ArrayList<>()).add(unit);
            if ("true".equals(unit.metadata().get("is_entry_point"))) {
                entryPointCount++;
            }
        }

        // 跨包调用边：按类聚合出入度与关键符号
        List<ClassEdge> classEdges = diagnostics.findClassCallEdges(projectId);
        Map<String, Integer> inbound = new LinkedHashMap<>();
        Map<String, Integer> outbound = new LinkedHashMap<>();
        Map<String, Integer> classInDegree = new LinkedHashMap<>();
        Set<String> crossPkgs = new LinkedHashSet<>();
        for (ClassEdge edge : classEdges) {
            String from = PackageCycleDetector.extractPackage(edge.callerClass());
            String to = PackageCycleDetector.extractPackage(edge.calleeClass());
            if (from.isEmpty() || to.isEmpty() || from.equals(to)) continue;
            outbound.merge(from, 1, Integer::sum);
            inbound.merge(to, 1, Integer::sum);
            classInDegree.merge(edge.calleeClass(), 1, Integer::sum);
            crossPkgs.add(from + "|" + to);
        }

        List<ComplexityMetric> complexityTop = complexityAnalyzer.topComplex(projectId, MAX_COMPLEXITY);

        List<PackageFacts> packages = new ArrayList<>();
        for (Map.Entry<String, List<CodeUnit>> entry : byPkg.entrySet()) {
            String pkg = entry.getKey();
            List<CodeUnit> pkgUnits = entry.getValue();
            int pkgEntryPoints = (int) pkgUnits.stream()
                    .filter(u -> "true".equals(u.metadata().get("is_entry_point")))
                    .count();
            packages.add(new PackageFacts(
                    pkg,
                    pkgUnits.size(),
                    pkgEntryPoints,
                    inbound.getOrDefault(pkg, 0),
                    outbound.getOrDefault(pkg, 0),
                    keySymbolsFor(pkg, pkgUnits, classInDegree)));
        }
        packages.sort(Comparator.comparingInt(PackageFacts::inboundCalls).reversed());

        return new ProjectStructureFacts(
                projectId,
                units.size(),
                entryPointCount,
                diagnostics.findDeadCode(projectId).size(),
                crossPkgs.size(),
                List.copyOf(packages),
                complexityTop);
    }

    /** 包的包名；无包结构（裸函数）归入 {@link PackageFacts#ROOT_PACKAGE}。 */
    static String pkgOf(CodeUnit unit) {
        String pkg = PackageCycleDetector.extractPackage(unit.qualifiedName());
        return pkg.isEmpty() ? PackageFacts.ROOT_PACKAGE : pkg;
    }

    /**
     * 关键符号：优先按跨包入度排序的被调用类；无跨包调用时取包内前几个类/文件单元。
     */
    private List<String> keySymbolsFor(String pkg, List<CodeUnit> pkgUnits,
                                       Map<String, Integer> classInDegree) {
        List<String> byDegree = classInDegree.entrySet().stream()
                .filter(e -> pkg.equals(PackageCycleDetector.extractPackage(e.getKey())))
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
                .limit(MAX_KEY_SYMBOLS)
                .map(Map.Entry::getKey)
                .toList();
        if (!byDegree.isEmpty()) return byDegree;

        return pkgUnits.stream()
                .filter(u -> u.kind() == com.repograph.core.model.CodeUnitKind.CLASS
                        || u.parentQualifiedName() == null)
                .map(CodeUnit::qualifiedName)
                .distinct()
                .limit(MAX_KEY_SYMBOLS)
                .toList();
    }
}
