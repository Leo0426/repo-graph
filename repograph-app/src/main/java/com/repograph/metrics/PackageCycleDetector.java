package com.repograph.metrics;

import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 包级别循环依赖检测器。
 *
 * <p>基于 {@link GraphDiagnosticsService#findClassCallEdges(String)} 提供的跨类调用边，
 * 聚合为包间依赖图，再使用 <em>Tarjan 强连通分量（SCC）算法</em> 找出所有循环依赖环。
 *
 * <p><b>局限：</b>
 * <ul>
 *   <li>仅考虑静态可分析的调用链（反射、动态代理不可见）。</li>
 *   <li>默认包（无 {@code package} 声明）的类不参与分析（提取结果为空字符串，过滤）。</li>
 * </ul>
 *
 * @author leolu
 * @since 0.6.0
 */
@Service
public class PackageCycleDetector {

    private final GraphDiagnosticsService graphQueryService;

    public PackageCycleDetector(GraphDiagnosticsService graphQueryService) {
        this.graphQueryService = graphQueryService;
    }

    /**
     * 检测指定项目中存在循环依赖的包组。
     *
     * @param projectId 项目唯一标识符
     * @return 每个 {@link PackageCycle} 代表一组互相循环依赖的包；无循环时返回空列表
     */
    public List<PackageCycle> findCycles(String projectId) {
        List<ClassEdge> edges = graphQueryService.findClassCallEdges(projectId);

        // 构建包级有向图（去除自环边）
        Map<String, Set<String>> adj = new HashMap<>();
        for (ClassEdge e : edges) {
            String from = extractPackage(e.callerClass());
            String to   = extractPackage(e.calleeClass());
            if (from.isEmpty() || to.isEmpty() || from.equals(to)) continue;
            adj.computeIfAbsent(from, k -> new HashSet<>()).add(to);
            adj.computeIfAbsent(to,   k -> new HashSet<>());
        }

        if (adj.isEmpty()) return List.of();

        // Tarjan SCC → 过滤 size ≥ 2 的分量即为真实环
        return tarjanSCC(adj).stream()
                .filter(scc -> scc.size() >= 2)
                .sorted((a, b) -> Integer.compare(b.size(), a.size())) // 大环优先
                .map(PackageCycle::new)
                .toList();
    }

    // ── Tarjan SCC（递归实现）──────────────────────────────────────────────

    private List<List<String>> tarjanSCC(Map<String, Set<String>> adj) {
        Map<String, Integer> index   = new HashMap<>();
        Map<String, Integer> lowLink = new HashMap<>();
        Set<String> onStack          = new HashSet<>();
        Deque<String> stack          = new ArrayDeque<>();
        List<List<String>> sccs      = new ArrayList<>();
        int[] counter                = {0};

        for (String node : adj.keySet()) {
            if (!index.containsKey(node)) {
                strongConnect(node, adj, index, lowLink, onStack, stack, sccs, counter);
            }
        }
        return sccs;
    }

    private void strongConnect(
            String v,
            Map<String, Set<String>> adj,
            Map<String, Integer> index,
            Map<String, Integer> lowLink,
            Set<String> onStack,
            Deque<String> stack,
            List<List<String>> sccs,
            int[] counter) {

        index.put(v, counter[0]);
        lowLink.put(v, counter[0]);
        counter[0]++;
        stack.push(v);
        onStack.add(v);

        for (String w : adj.getOrDefault(v, Set.of())) {
            if (!index.containsKey(w)) {
                strongConnect(w, adj, index, lowLink, onStack, stack, sccs, counter);
                lowLink.put(v, Math.min(lowLink.get(v), lowLink.get(w)));
            } else if (onStack.contains(w)) {
                lowLink.put(v, Math.min(lowLink.get(v), index.get(w)));
            }
        }

        if (lowLink.get(v).equals(index.get(v))) {
            List<String> scc = new ArrayList<>();
            String w;
            do {
                w = stack.pop();
                onStack.remove(w);
                scc.add(w);
            } while (!w.equals(v));
            sccs.add(scc);
        }
    }

    public static String extractPackage(String className) {
        if (className == null) return "";
        int dot = className.lastIndexOf('.');
        return dot >= 0 ? className.substring(0, dot) : "";
    }
}
