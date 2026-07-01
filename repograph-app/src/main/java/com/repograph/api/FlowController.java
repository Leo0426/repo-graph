package com.repograph.api;

import com.repograph.core.flow.FlowAnalysisResult;
import com.repograph.core.flow.FlowAnalysisService;
import com.repograph.core.flow.TaintAnalysisService;
import com.repograph.core.flow.TaintResult;
import com.repograph.core.graph.GraphQueryService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Optional;

/**
 * 按需函数内数据流、控制流和程序依赖图 REST API。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/flow")
public class FlowController {

    private final GraphQueryService graphQueryService;
    private final List<FlowAnalysisService> flowAnalysisServices;
    private final TaintAnalysisService taintAnalysisService;

    public FlowController(GraphQueryService graphQueryService,
                          List<FlowAnalysisService> flowAnalysisServices,
                          TaintAnalysisService taintAnalysisService) {
        this.graphQueryService = graphQueryService;
        this.flowAnalysisServices = flowAnalysisServices;
        this.taintAnalysisService = taintAnalysisService;
    }

    /**
     * 分析目标方法或函数。
     *
     * @param target    完整 qualifiedName
     * @param projectId 可选项目 ID
     * @return 数据流摘要、CFG 与轻量 PDG；符号不存在或暂不支持时返回 404
     */
    @GetMapping("/analyze")
    public ResponseEntity<FlowAnalysisResult> analyze(
            @RequestParam String target,
            @RequestParam(required = false) String projectId) {
        return graphQueryService.findSymbol(target, projectId)
                .flatMap(unit -> flowAnalysisServices.stream()
                        .map(s -> s.analyze(unit))
                        .filter(Optional::isPresent)
                        .map(Optional::get)
                        .findFirst())
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * 跨过程污点分析：从指定方法参数出发，沿调用图追踪污点传播路径直到 Sink。
     *
     * @param source     污点源方法全限定名
     * @param paramIndex 污点源参数下标（0-based，默认 0）
     * @param projectId  可选项目 ID
     * @param maxDepth   最大调用深度（默认 6，上限 15）
     * @return 污点传播结果，包含所有发现的路径
     */
    @GetMapping("/taint")
    public TaintResult taint(
            @RequestParam String source,
            @RequestParam(defaultValue = "0") int paramIndex,
            @RequestParam(required = false) String projectId,
            @RequestParam(defaultValue = "6") int maxDepth) {
        int depth = Math.min(maxDepth, 15);
        return taintAnalysisService.analyzeTaint(source, paramIndex, projectId, depth);
    }
}
