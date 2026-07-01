package com.repograph.export;

import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.metrics.PackageCycleDetector;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 依赖图导出服务，支持 Graphviz DOT 和 Mermaid 两种格式。
 *
 * <p>以包（package）为节点粒度，聚合跨类调用边为包间依赖关系。
 * 处于循环依赖环中的包节点在 DOT 输出中以红色高亮显示。
 *
 * <p>典型用法：
 * <ul>
 *   <li>DOT：通过 Graphviz 生成 PNG/SVG，嵌入文档或 Wiki</li>
 *   <li>Mermaid：直接粘贴到 GitHub / GitLab / Notion 的 Markdown 块中渲染</li>
 * </ul>
 *
 * @author leolu
 * @since 0.7.0
 */
@Service
public class GraphExportService {

    private final GraphDiagnosticsService graphQueryService;
    private final PackageCycleDetector packageCycleDetector;

    public GraphExportService(GraphDiagnosticsService graphQueryService,
                              PackageCycleDetector packageCycleDetector) {
        this.graphQueryService = graphQueryService;
        this.packageCycleDetector = packageCycleDetector;
    }

    /**
     * 导出为 Graphviz DOT 格式（包级别依赖图）。
     *
     * <p>特性：
     * <ul>
     *   <li>有向图，从调用方指向被调用方</li>
     *   <li>边标签显示跨类调用次数（Class 级别调用对数量）</li>
     *   <li>循环依赖包以红色填充高亮</li>
     * </ul>
     *
     * @param projectId 项目 ID
     * @return DOT 格式文本；无数据时返回只含根节点的最小图
     */
    public String exportDot(String projectId) {
        List<ClassEdge> edges = graphQueryService.findClassCallEdges(projectId);
        Set<String> cyclicPkgs = cyclicPackages(projectId);

        // 包来源 → 包目标 → 调用次数
        Map<String, Map<String, Integer>> edgeCounts = buildPkgEdgeCounts(edges);
        Set<String> allPkgs = collectPackages(edgeCounts);

        StringBuilder sb = new StringBuilder(1024);
        sb.append("digraph RepoGraph {\n");
        sb.append("    rankdir=LR;\n");
        sb.append("    graph [label=\"").append(dotEscape(projectId))
          .append("\", fontname=Helvetica, fontsize=12];\n");
        sb.append("    node [shape=box, fontname=Helvetica, fontsize=10];\n");
        sb.append("    edge [fontsize=8, color=\"#555555\"];\n\n");

        for (String pkg : allPkgs) {
            String label = shortName(pkg);
            String attrs = cyclicPkgs.contains(pkg)
                    ? " color=red, style=filled, fillcolor=\"#fff0f0\""
                    : "";
            sb.append(String.format("    \"%s\" [label=\"%s\" tooltip=\"%s\"%s];%n",
                    dotEscape(pkg), dotEscape(label), dotEscape(pkg), attrs));
        }

        sb.append("\n");
        for (Map.Entry<String, Map<String, Integer>> fromEntry : edgeCounts.entrySet()) {
            for (Map.Entry<String, Integer> toEntry : fromEntry.getValue().entrySet()) {
                boolean bothCyclic = cyclicPkgs.contains(fromEntry.getKey())
                        && cyclicPkgs.contains(toEntry.getKey());
                String edgeColor = bothCyclic ? " color=red" : "";
                sb.append(String.format("    \"%s\" -> \"%s\" [label=\"%d\"%s];%n",
                        dotEscape(fromEntry.getKey()), dotEscape(toEntry.getKey()),
                        toEntry.getValue(), edgeColor));
            }
        }

        sb.append("}\n");
        return sb.toString();
    }

    /**
     * 导出为 Mermaid 格式（包级别依赖图）。
     *
     * <p>可直接粘贴进 GitHub / GitLab / Notion / Obsidian 的 Markdown 代码块中渲染：
     * <pre>{@code
     * ```mermaid
     * graph LR
     *     ...
     * ```
     * }</pre>
     *
     * @param projectId 项目 ID
     * @return Mermaid 格式文本
     */
    public String exportMermaid(String projectId) {
        List<ClassEdge> edges = graphQueryService.findClassCallEdges(projectId);
        Set<String> cyclicPkgs = cyclicPackages(projectId);

        Map<String, Map<String, Integer>> edgeCounts = buildPkgEdgeCounts(edges);
        Set<String> allPkgs = collectPackages(edgeCounts);

        StringBuilder sb = new StringBuilder(1024);
        sb.append("graph LR\n");

        for (String pkg : allPkgs) {
            String id = mermaidId(pkg);
            String label = shortName(pkg);
            if (cyclicPkgs.contains(pkg)) {
                sb.append(String.format("    %s[\"%s\"]::cyclic%n", id, label));
            } else {
                sb.append(String.format("    %s[\"%s\"]%n", id, label));
            }
        }

        if (!cyclicPkgs.isEmpty()) {
            sb.append("\n    classDef cyclic fill:#fff0f0,stroke:#cc0000,color:#cc0000\n");
        }

        sb.append("\n");
        for (Map.Entry<String, Map<String, Integer>> fromEntry : edgeCounts.entrySet()) {
            for (Map.Entry<String, Integer> toEntry : fromEntry.getValue().entrySet()) {
                sb.append(String.format("    %s -->|%d| %s%n",
                        mermaidId(fromEntry.getKey()),
                        toEntry.getValue(),
                        mermaidId(toEntry.getKey())));
            }
        }

        return sb.toString();
    }

    // ── 内部辅助方法 ──────────────────────────────────────────────────────────

    private Set<String> cyclicPackages(String projectId) {
        return packageCycleDetector.findCycles(projectId).stream()
                .flatMap(c -> c.packages().stream())
                .collect(Collectors.toSet());
    }

    private static Map<String, Map<String, Integer>> buildPkgEdgeCounts(List<ClassEdge> edges) {
        Map<String, Map<String, Integer>> result = new LinkedHashMap<>();
        for (ClassEdge e : edges) {
            String from = PackageCycleDetector.extractPackage(e.callerClass());
            String to   = PackageCycleDetector.extractPackage(e.calleeClass());
            if (from.isEmpty() || to.isEmpty() || from.equals(to)) continue;
            result.computeIfAbsent(from, k -> new LinkedHashMap<>()).merge(to, 1, Integer::sum);
        }
        return result;
    }

    private static Set<String> collectPackages(Map<String, Map<String, Integer>> edgeCounts) {
        Set<String> pkgs = new LinkedHashSet<>(edgeCounts.keySet());
        edgeCounts.values().forEach(m -> pkgs.addAll(m.keySet()));
        return pkgs;
    }

    /**
     * 仅保留包名最后两段，避免图节点标签过长。
     * 例如 {@code com.example.service.impl} → {@code service.impl}
     */
    static String shortName(String pkg) {
        if (pkg == null || pkg.isEmpty()) return pkg;
        String[] parts = pkg.split("\\.");
        if (parts.length <= 2) return pkg;
        return parts[parts.length - 2] + "." + parts[parts.length - 1];
    }

    /** DOT 格式中对双引号转义。 */
    private static String dotEscape(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    /**
     * Mermaid 节点 ID 只允许字母、数字和下划线，不能以数字开头。
     * 将点和连字符替换为下划线。
     */
    static String mermaidId(String pkg) {
        if (pkg == null || pkg.isEmpty()) return "_empty";
        return pkg.replace('.', '_').replace('-', '_');
    }
}
