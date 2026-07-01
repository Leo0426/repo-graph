package com.repograph.api;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import com.repograph.core.graph.ProjectStats;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 项目发现 REST API，返回当前 Neo4j 中已注册的所有项目元信息。
 *
 * <p>主要服务于 dashboard 项目选择器和 CLI {@code --project} 自动补全，避免用户手动
 * 计算 {@code SHA256(projectRoot)[:12]}。
 *
 * @author leolu
 * @since 0.2.0
 */
@RestController
@RequestMapping("/api/v1")
public class ProjectsController {

    private final GraphQueryService graphQueryService;

    /**
     * 通过构造器注入图查询服务。
     *
     * @param graphQueryService 图查询服务，不为 {@code null}
     */
    public ProjectsController(GraphQueryService graphQueryService) {
        this.graphQueryService = graphQueryService;
    }

    /**
     * 列出所有已注册项目（按 projectId 字典序排列）。
     *
     * @return {@link ProjectInfo} 列表；无项目时返回空数组
     */
    @GetMapping("/projects")
    public List<ProjectInfo> projects() {
        return graphQueryService.listProjects();
    }

    /**
     * 返回指定项目的图谱聚合统计，供 dashboard 概览面板使用。
     *
     * <p>项目不存在时仍返回零计数 {@link ProjectStats}（HTTP 200），调用方据此显示"无数据"状态。
     *
     * @param projectId 12 字符 projectId 前缀
     * @return 该项目的聚合统计快照
     */
    @GetMapping("/projects/{projectId}/stats")
    public ProjectStats projectStats(@PathVariable String projectId) {
        return graphQueryService.projectStats(projectId);
    }
}
