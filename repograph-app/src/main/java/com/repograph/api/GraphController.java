package com.repograph.api;

import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 代码图查询 REST API，支持调用链追踪、影响面分析和子类查询。
 *
 * @author leolu
 * @since 0.1.0
 */
@RestController
@RequestMapping("/api/v1/graph")
public class GraphController {

    private final GraphQueryService graphQueryService;
    private final GraphDiagnosticsService graphDiagnosticsService;

    public GraphController(GraphQueryService graphQueryService,
                           GraphDiagnosticsService graphDiagnosticsService) {
        this.graphQueryService = graphQueryService;
        this.graphDiagnosticsService = graphDiagnosticsService;
    }

    /**
     * 查询调用指定方法的调用方列表。
     *
     * @param target 目标方法全限定名，不为 {@code null}
     * @param depth  遍历深度，默认 3
     * @return 调用方 {@link CodeUnit} 列表
     */
    @GetMapping("/callers")
    public List<CodeUnit> callers(
            @RequestParam String target,
            @RequestParam(defaultValue = "3") int depth,
            @RequestParam(required = false) String projectId) {
        return projectId == null || projectId.isBlank()
                ? graphQueryService.findCallers(target, depth)
                : graphQueryService.findCallers(target, depth, projectId);
    }

    /**
     * 查询变更指定符号后的影响范围。
     *
     * @param target 目标符号全限定名，不为 {@code null}
     * @return 受影响的 {@link CodeUnit} 集合
     */
    @GetMapping("/impact")
    public Set<CodeUnit> impact(
            @RequestParam String target,
            @RequestParam(required = false) String projectId) {
        return projectId == null || projectId.isBlank()
                ? graphQueryService.impactAnalysis(target)
                : graphQueryService.impactAnalysis(target, projectId);
    }

    /**
     * 查询指定方法直接或间接调用的被调用方列表（出边方向）。
     *
     * @param target 发起调用的方法全限定名，不为 {@code null}
     * @param depth  遍历深度，默认 3（与 {@link #callers} 保持一致）
     * @return 被调用方 {@link CodeUnit} 列表
     */
    @GetMapping("/callees")
    public List<CodeUnit> callees(
            @RequestParam String target,
            @RequestParam(defaultValue = "3") int depth,
            @RequestParam(required = false) String projectId) {
        return projectId == null || projectId.isBlank()
                ? graphQueryService.findCallees(target, depth)
                : graphQueryService.findCallees(target, depth, projectId);
    }

    /**
     * 查询指定类型的所有子类型。
     *
     * @param target 目标类/接口全限定名，不为 {@code null}
     * @return 子类型 {@link CodeUnit} 列表
     */
    @GetMapping("/subtypes")
    public List<CodeUnit> subtypes(
            @RequestParam String target,
            @RequestParam(required = false) String projectId) {
        return projectId == null || projectId.isBlank()
                ? graphQueryService.findSubTypes(target)
                : graphQueryService.findSubTypes(target, projectId);
    }

    /**
     * 按部分名称查找完整图符号候选。
     *
     * @param query     qualifiedName 或 simpleName 的部分文本
     * @param projectId 可选项目 ID
     * @param limit     最大候选数，默认 10
     * @return 完整符号候选
     */
    @GetMapping("/symbols")
    public List<CodeUnit> symbols(
            @RequestParam("q") String query,
            @RequestParam(required = false) String projectId,
            @RequestParam(defaultValue = "10") int limit) {
        return graphQueryService.findSymbols(query, projectId, limit);
    }

    /**
     * 查询项目中所有入口点（{@code metadata.is_entry_point=true}）。
     *
     * @param projectId 可选 projectId 过滤；为空时返回所有已加载项目的入口点
     * @param lang      可选语言过滤（java / c / python），为空时返回全部
     * @return 入口点 {@link CodeUnit} 列表
     */
    @GetMapping("/entrypoints")
    public List<CodeUnit> entrypoints(
            @RequestParam(required = false) String projectId,
            @RequestParam(required = false) String lang) {
        List<CodeUnit> all = graphQueryService.findEntryPoints(projectId);
        if (lang != null && !lang.isBlank()) {
            return all.stream().filter(u -> lang.equals(u.language())).collect(Collectors.toList());
        }
        return all;
    }

    /**
     * 查找指定项目中疑似死代码的方法和函数：在调用图中不存在任何调用方，且不是已知入口点。
     *
     * <p>结果属于启发式分析，反射调用、序列化回调等动态场景可能造成误报，需人工复核。
     *
     * @param projectId 项目唯一标识符，不为 {@code null}
     * @return 疑似死代码的 {@link CodeUnit} 列表，按文件路径和行号排序
     */
    @GetMapping("/deadcode")
    public List<CodeUnit> deadCode(@RequestParam String projectId) {
        return graphDiagnosticsService.findDeadCode(projectId);
    }

    /**
     * 查找指定项目中没有任何测试覆盖路径的生产方法（测试空白）。
     *
     * <p>从所有测试单元（{@code is_test='true'}）出发，沿 {@code CALLS} 边向下遍历（深度 ≤ 6），
     * 收集可达方法集合，返回不在该集合内的生产代码单元。
     *
     * <p>结果属于启发式分析，反射调用不可见，需人工复核。
     *
     * @param projectId 项目唯一标识符，不为 {@code null}
     * @return 无测试覆盖路径的生产 {@link CodeUnit} 列表，按文件路径和行号排序
     */
    @GetMapping("/testgaps")
    public List<CodeUnit> testGaps(@RequestParam String projectId) {
        return graphDiagnosticsService.findTestGaps(projectId);
    }
}
