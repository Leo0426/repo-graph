package com.repograph.app.cli;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.util.List;

/**
 * {@code repograph entrypoints} 子命令，列出指定项目的所有入口点（框架注解标记的公开方法）。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
    name = "entrypoints",
    mixinStandardHelpOptions = true,
    description = "列出指定项目的所有入口点（框架注解标记的公开方法）"
)
@Component
public class EntryPointsCommand implements Runnable {

    @Option(names = "--project", description = "projectId（12 字符前缀）；省略时返回所有已加载项目的入口点")
    private String projectId;

    private final GraphQueryService graphQueryService;
    private final ObjectMapper objectMapper;

    /**
     * 通过构造器注入图查询服务和 JSON 序列化工具。
     *
     * @param graphQueryService 图查询服务，不为 {@code null}
     * @param objectMapper      Jackson ObjectMapper，不为 {@code null}
     */
    public EntryPointsCommand(GraphQueryService graphQueryService, ObjectMapper objectMapper) {
        this.graphQueryService = graphQueryService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        List<CodeUnit> entryPoints = graphQueryService.findEntryPoints(projectId);
        if (entryPoints.isEmpty()) {
            System.out.println("No entry points found" + (projectId != null ? " for project: " + projectId : ""));
            return;
        }
        System.err.printf("Found %d entry point(s)%s%n",
            entryPoints.size(), projectId != null ? " for project '" + projectId + "'" : "");
        try {
            System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(entryPoints));
        } catch (Exception e) {
            System.err.println("[ERROR] Serialization failed: " + e.getMessage());
        }
    }
}
