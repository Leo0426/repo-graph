package com.repograph.app.cli;

import com.repograph.export.GraphExportService;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * CLI: {@code repograph export <projectId> [--format dot|mermaid] [--out <file>]}
 *
 * <p>将项目包级别依赖图导出为 Graphviz DOT 或 Mermaid 格式。
 *
 * <p>示例：
 * <pre>{@code
 * # 生成 Mermaid（直接粘贴到 GitHub Markdown）
 * repograph export my-project
 *
 * # 生成 DOT 并渲染 PNG
 * repograph export my-project --format dot --out deps.dot
 * dot -Tpng deps.dot -o deps.png
 *
 * # 写入文件
 * repograph export my-project --format mermaid --out deps.mmd
 * }</pre>
 *
 * @author leolu
 * @since 0.7.0
 */
@Command(
        name = "export",
        mixinStandardHelpOptions = true,
        description = "导出包级别依赖图（Graphviz DOT 或 Mermaid 格式）"
)
@Component
public class ExportCommand implements Runnable {

    private final GraphExportService graphExportService;

    @Parameters(index = "0", description = "项目 ID")
    private String projectId;

    @Option(names = {"--format", "-f"},
            description = "输出格式：dot（Graphviz）或 mermaid（默认）",
            defaultValue = "mermaid")
    private String format;

    @Option(names = {"--out", "-o"}, description = "将输出写入文件（默认写入 stdout）")
    private Path outFile;

    public ExportCommand(GraphExportService graphExportService) {
        this.graphExportService = graphExportService;
    }

    @Override
    public void run() {
        String output = "dot".equalsIgnoreCase(format)
                ? graphExportService.exportDot(projectId)
                : graphExportService.exportMermaid(projectId);

        if (outFile != null) {
            try {
                Files.writeString(outFile, output, StandardCharsets.UTF_8);
                System.err.printf("Graph written to %s%n", outFile.toAbsolutePath());
            } catch (IOException e) {
                System.err.printf("Failed to write file: %s%n", e.getMessage());
                System.exit(1);
            }
        } else {
            System.out.print(output);
        }
    }
}
