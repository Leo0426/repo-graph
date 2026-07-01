package com.repograph.app.cli;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;

import java.util.List;

/**
 * {@code repograph projects} 子命令，列出 Neo4j 中所有已注册的项目（projectId / 根目录 / 节点数）。
 *
 * @author leolu
 * @since 0.2.0
 */
@Command(
    name = "projects",
    mixinStandardHelpOptions = true,
    description = "列出所有已索引项目（按 projectId 字典序）"
)
@Component
public class ProjectsCommand implements Runnable {

    private final GraphQueryService graphQueryService;

    /**
     * 通过构造器注入图查询服务。
     *
     * @param graphQueryService 图查询服务，不为 {@code null}
     */
    public ProjectsCommand(GraphQueryService graphQueryService) {
        this.graphQueryService = graphQueryService;
    }

    @Override
    public void run() {
        List<ProjectInfo> projects = graphQueryService.listProjects();
        if (projects.isEmpty()) {
            System.out.println("No indexed projects found.");
            return;
        }
        // 以纯文本表格输出到 stdout，宽度适配常规路径；超长时不换行，可通过 `column` 命令格式化。
        System.out.printf("%-13s  %-10s  %s%n", "PROJECT_ID", "UNITS", "ROOT");
        System.out.printf("%-13s  %-10s  %s%n", "-".repeat(13), "-".repeat(10), "-".repeat(40));
        for (ProjectInfo p : projects) {
            System.out.printf("%-13s  %-10d  %s%n",
                p.projectId(), p.nodeCount(),
                p.projectRoot().isEmpty() ? "(unknown)" : p.projectRoot());
        }
    }
}
