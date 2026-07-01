package com.repograph.api;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 框架检测 REST API，返回指定项目中识别到的框架入口点列表。
 *
 * @author leolu
 * @since 0.1.0
 */
@RestController
@RequestMapping("/api/v1")
public class FrameworkController {

    private final GraphQueryService graphQueryService;

    /**
     * 通过构造器注入图查询服务。
     *
     * @param graphQueryService 图查询服务，不为 {@code null}
     */
    public FrameworkController(GraphQueryService graphQueryService) {
        this.graphQueryService = graphQueryService;
    }

    /**
     * 返回指定项目中所有框架入口点（{@code is_entry_point=true}）的代码单元列表。
     *
     * @param projectId 项目唯一标识符，用于过滤（路径变量）
     * @return 框架入口点 {@link CodeUnit} 列表，无结果时返回空列表
     */
    @GetMapping("/frameworks/{projectId}")
    public List<CodeUnit> frameworks(@PathVariable String projectId) {
        return graphQueryService.findEntryPoints(projectId);
    }
}
