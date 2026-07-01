package com.repograph.api;

import com.repograph.core.retrieval.GraphRagOptions;
import com.repograph.core.retrieval.GraphRagResult;
import com.repograph.retrieval.GraphRagService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * GraphRAG 检索 REST API，融合向量搜索、调用图展开、影响面扩展与安全感知重排序。
 *
 * <p>相比纯向量检索（{@code /api/v1/search/semantic}），GraphRAG 检索在找到语义相关种子后：
 * <ul>
 *   <li>沿调用图向上/向下展开，覆盖"语义相关但名字无关"的调用链节点</li>
 *   <li>对安全敏感方法（认证/授权/SQL 执行/加密等）给予评分加成并优先返回</li>
 *   <li>通过影响面分析补充数据流路径上的安全敏感节点</li>
 * </ul>
 *
 * @see GraphRagService
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/search")
public class GraphRagController {

    private static final int MAX_SEED_LIMIT = 20;
    private static final int MAX_GRAPH_DEPTH = 3;

    private final GraphRagService graphRagService;

    /**
     * 创建 GraphRAG REST 控制器。
     *
     * @param graphRagService GraphRAG 编排服务
     */
    public GraphRagController(GraphRagService graphRagService) {
        this.graphRagService = graphRagService;
    }

    /**
     * 执行 GraphRAG 检索。
     *
     * @param q         自然语言查询字符串
     * @param lang      可选语言过滤（java / c / python）
     * @param projectId 可选项目 ID 过滤
     * @param limit     向量种子数量，默认 10，上限 20
     * @param depth     调用图展开深度，默认 1，上限 3
     * @param callGraph 是否开启调用图展开，默认 true
     * @param impactExpansion 是否开启影响面扩展，默认 true
     * @param dataFlow  旧版影响面扩展参数，保留用于兼容
     * @param rerank    是否开启安全感知重排序，默认 true
     * @param noTest    是否排除测试代码，默认 true
     * @return 包含综合排序结果与检索统计的 {@link GraphRagResult}
     */
    @GetMapping("/graphrag")
    public GraphRagResult graphRag(
            @RequestParam String q,
            @RequestParam(required = false) String lang,
            @RequestParam(required = false) String projectId,
            @RequestParam(defaultValue = "10") int limit,
            @RequestParam(defaultValue = "1") int depth,
            @RequestParam(defaultValue = "true") boolean callGraph,
            @RequestParam(required = false) Boolean impactExpansion,
            @RequestParam(required = false) Boolean dataFlow,
            @RequestParam(defaultValue = "true") boolean rerank,
            @RequestParam(defaultValue = "true") boolean noTest) {
        boolean expandImpact = impactExpansion != null
                ? impactExpansion
                : dataFlow == null || dataFlow;
        GraphRagOptions opts = new GraphRagOptions(
                Math.max(1, Math.min(limit, MAX_SEED_LIMIT)),
                Math.max(1, Math.min(depth, MAX_GRAPH_DEPTH)),
                callGraph, expandImpact, rerank, projectId, lang, noTest);
        return graphRagService.search(q, opts);
    }
}
