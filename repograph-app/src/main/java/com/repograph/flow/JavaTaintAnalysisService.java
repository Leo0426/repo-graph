package com.repograph.flow;

import com.repograph.core.flow.MethodTaintSummary;
import com.repograph.core.flow.TaintAnalysisService;
import com.repograph.core.flow.TaintEdge;
import com.repograph.core.flow.TaintHop;
import com.repograph.core.flow.TaintPath;
import com.repograph.core.flow.TaintResult;
import com.repograph.core.flow.TaintSlot;
import com.repograph.core.flow.TaintSummaryService;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 基于调用图 BFS 的跨过程污点传播引擎。
 *
 * <p>算法：
 * <ol>
 *   <li>从污点源方法出发，通过 {@link TaintSummaryService} 获取方法内摘要；</li>
 *   <li>对摘要中每条 {@code param[i] → callArg(callee, j)} 边，在 Neo4j 中找到匹配的 callee；</li>
 *   <li>将 {@code callee.param[j]} 加入 worklist，递归展开直到命中 Sink 或达到深度限制；</li>
 *   <li>Sink 命中记录为完整 {@link TaintPath}；非 Sink 路径在达到深度上限时截断并标记。</li>
 * </ol>
 *
 * <p>Callee 匹配策略：用调用表达式中的简单方法名（如 {@code executeQuery}）与
 * Neo4j 返回的直接被调用方 {@code qualifiedName} 的方法名部分（{@code #} 后、{@code (} 前）对比。
 * 同名多重载时保守地全部展开（over-approximate）。
 *
 * @author leolu
 */
@Service
public class JavaTaintAnalysisService implements TaintAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(JavaTaintAnalysisService.class);

    /** 单次分析最多输出路径数，防止路径爆炸。 */
    private static final int MAX_PATHS = 50;
    /** 单次分析最多展开方法数，防止遍历过大调用图。 */
    private static final int MAX_METHODS = 200;

    private final TaintSummaryService taintSummaryService;
    private final GraphQueryService graphQueryService;

    public JavaTaintAnalysisService(TaintSummaryService taintSummaryService,
                                    GraphQueryService graphQueryService) {
        this.taintSummaryService = taintSummaryService;
        this.graphQueryService = graphQueryService;
    }

    @Override
    public TaintResult analyzeTaint(String sourceMethodQn, int sourceParamIndex,
                                    String projectId, int maxDepth) {
        List<TaintPath> paths = new ArrayList<>();
        Set<String> visited = new HashSet<>();
        // worklist 元素：(方法全限定名, 参数下标, 已累积跳数, 当前深度)
        Deque<WorkItem> worklist = new ArrayDeque<>();
        worklist.add(new WorkItem(sourceMethodQn, sourceParamIndex, List.of(), 0));

        int methodsAnalyzed = 0;
        boolean truncated = false;

        outer:
        while (!worklist.isEmpty()) {
            WorkItem item = worklist.poll();
            String key = item.methodQn + ":" + item.paramIdx;
            if (!visited.add(key)) continue;
            if (item.depth > maxDepth) { truncated = true; continue; }
            if (methodsAnalyzed >= MAX_METHODS) { truncated = true; break; }

            // 获取该方法的 CodeUnit（需要 rawSource 用于 AST 分析）
            Optional<CodeUnit> unitOpt = graphQueryService.findSymbol(item.methodQn, projectId);
            if (unitOpt.isEmpty()) continue;
            methodsAnalyzed++;

            Optional<MethodTaintSummary> summaryOpt = taintSummaryService.summarize(unitOpt.get());
            if (summaryOpt.isEmpty()) continue;

            MethodTaintSummary summary = summaryOpt.get();
            TaintSlot source = TaintSlot.param(item.paramIdx);

            for (TaintEdge edge : summary.edges()) {
                if (!edge.from().equals(source)) continue;
                TaintSlot to = edge.to();
                TaintHop hop = new TaintHop(item.methodQn, edge.from(), to);
                List<TaintHop> newHops = append(item.hops, hop);

                switch (to.kind()) {
                    case SINK -> {
                        paths.add(new TaintPath(newHops, true, to.toString()));
                        if (paths.size() >= MAX_PATHS) { truncated = true; break outer; }
                    }
                    case RETURN -> {
                        // 返回值传播：加入路径但不继续（需要调用者上下文，当前 MVP 不展开）
                        paths.add(new TaintPath(newHops, false, null));
                        if (paths.size() >= MAX_PATHS) { truncated = true; break outer; }
                    }
                    case CALL_ARG -> {
                        // 找到与 calleeHint 简单名匹配的直接 callee
                        if (item.depth < maxDepth) {
                            List<CodeUnit> callees = graphQueryService.findCallees(
                                    item.methodQn, 1, projectId);
                            for (CodeUnit callee : callees) {
                                if (simpleNameMatches(callee.qualifiedName(), to.calleeHint())) {
                                    String calleeKey = callee.qualifiedName() + ":" + to.index();
                                    if (!visited.contains(calleeKey)) {
                                        worklist.add(new WorkItem(
                                                callee.qualifiedName(), to.index(),
                                                newHops, item.depth + 1));
                                    }
                                }
                            }
                        } else {
                            truncated = true;
                        }
                    }
                    default -> { /* PARAM 不会出现在 to 中 */ }
                }
            }
        }

        log.debug("Taint analysis of {}:param[{}] → {} paths, {} methods analyzed",
                sourceMethodQn, sourceParamIndex, paths.size(), methodsAnalyzed);
        return new TaintResult(sourceMethodQn, sourceParamIndex,
                List.copyOf(paths), methodsAnalyzed, truncated);
    }

    /**
     * 判断 callee 的全限定名方法部分是否与调用表达式中的简单名匹配。
     *
     * <p>例：{@code "com.example.Dao#executeQuery(String)"} 匹配 hint {@code "executeQuery"}。
     */
    private static boolean simpleNameMatches(String qualifiedName, String hint) {
        if (hint == null || hint.isBlank()) return false;
        int hash = qualifiedName.indexOf('#');
        if (hash < 0) return false;
        String methodPart = qualifiedName.substring(hash + 1);
        int paren = methodPart.indexOf('(');
        String simpleName = paren >= 0 ? methodPart.substring(0, paren) : methodPart;
        return simpleName.equals(hint);
    }

    private static <T> List<T> append(List<T> list, T item) {
        List<T> result = new ArrayList<>(list);
        result.add(item);
        return List.copyOf(result);
    }

    private record WorkItem(String methodQn, int paramIdx, List<TaintHop> hops, int depth) {}
}
