package com.repograph.api;

import com.repograph.core.retrieval.ContextPack;
import com.repograph.core.retrieval.ContextPackOptions;
import com.repograph.core.retrieval.GraphRagOptions;
import com.repograph.retrieval.ContextPackService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * LLM Agent 上下文包 REST API，基于 GraphRAG 结果生成带 citation 的证据列表。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/context")
public class ContextPackController {

    private static final int MAX_SEED_LIMIT = 20;
    private static final int MAX_GRAPH_DEPTH = 3;
    private static final int MIN_BUDGET_CHARS = 1000;
    private static final int MAX_BUDGET_CHARS = 60000;

    private final ContextPackService contextPackService;

    /**
     * 创建 Context Pack REST 控制器。
     *
     * @param contextPackService 上下文包服务
     */
    public ContextPackController(ContextPackService contextPackService) {
        this.contextPackService = contextPackService;
    }

    /**
     * 构建面向 Agent 的上下文包。
     *
     * @param q               自然语言查询
     * @param taskType        任务类型
     * @param budgetChars     上下文字符预算
     * @param lang            可选语言过滤
     * @param projectId       可选项目 ID
     * @param limit           向量种子数量
     * @param depth           调用图展开深度
     * @param callGraph       是否开启调用图展开
     * @param impactExpansion 是否开启影响面扩展
     * @param rerank          是否开启安全重排序
     * @param noTest          是否排除测试代码
     * @return 上下文包
     */
    @GetMapping("/pack")
    public ContextPack pack(
            @RequestParam String q,
            @RequestParam(defaultValue = "detail") String taskType,
            @RequestParam(defaultValue = "12000") int budgetChars,
            @RequestParam(required = false) String lang,
            @RequestParam(required = false) String projectId,
            @RequestParam(defaultValue = "10") int limit,
            @RequestParam(defaultValue = "1") int depth,
            @RequestParam(defaultValue = "true") boolean callGraph,
            @RequestParam(defaultValue = "true") boolean impactExpansion,
            @RequestParam(defaultValue = "true") boolean rerank,
            @RequestParam(defaultValue = "true") boolean noTest) {
        GraphRagOptions graphRag = new GraphRagOptions(
                Math.max(1, Math.min(limit, MAX_SEED_LIMIT)),
                Math.max(1, Math.min(depth, MAX_GRAPH_DEPTH)),
                callGraph,
                impactExpansion,
                rerank,
                projectId,
                lang,
                noTest
        );
        ContextPackOptions opts = new ContextPackOptions(
                taskType,
                Math.max(MIN_BUDGET_CHARS, Math.min(budgetChars, MAX_BUDGET_CHARS)),
                graphRag
        );
        return contextPackService.build(q, opts);
    }
}
