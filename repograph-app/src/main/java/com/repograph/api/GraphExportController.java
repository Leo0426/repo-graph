package com.repograph.api;

import com.repograph.export.GraphExportService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 依赖图导出 REST API。
 *
 * <ul>
 *   <li>{@code GET /api/v1/export/graph?projectId=&format=dot}    — Graphviz DOT</li>
 *   <li>{@code GET /api/v1/export/graph?projectId=&format=mermaid} — Mermaid</li>
 * </ul>
 *
 * <p>两个端点均以 {@code text/plain} 返回，浏览器可直接查看，
 * 也可通过 {@code curl} 重定向到文件：
 * <pre>{@code
 * curl "http://localhost:8080/api/v1/export/graph?projectId=xxx&format=dot" > deps.dot
 * dot -Tpng deps.dot -o deps.png
 * }</pre>
 *
 * @author leolu
 * @since 0.7.0
 */
@RestController
@RequestMapping("/api/v1/export")
public class GraphExportController {

    private final GraphExportService graphExportService;

    public GraphExportController(GraphExportService graphExportService) {
        this.graphExportService = graphExportService;
    }

    /**
     * 导出包级别依赖图。
     *
     * @param projectId 项目 ID
     * @param format    导出格式：{@code dot}（Graphviz，默认）或 {@code mermaid}
     * @return 文本格式的依赖图
     */
    @GetMapping(value = "/graph", produces = MediaType.TEXT_PLAIN_VALUE)
    public String exportGraph(
            @RequestParam String projectId,
            @RequestParam(defaultValue = "dot") String format) {
        return "mermaid".equalsIgnoreCase(format)
                ? graphExportService.exportMermaid(projectId)
                : graphExportService.exportDot(projectId);
    }
}
