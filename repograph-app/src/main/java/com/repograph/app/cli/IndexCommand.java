package com.repograph.app.cli;

import com.repograph.core.pipeline.IndexOptions;
import com.repograph.core.pipeline.IndexPipeline;
import com.repograph.core.pipeline.IndexResult;
import com.repograph.core.parser.ParseStrategy;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

/**
 * {@code repograph index} 子命令，扫描并索引指定项目根目录下的所有源文件。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
        name = "index",
        mixinStandardHelpOptions = true,
        description = "扫描项目根目录并建立向量索引和代码知识图谱"
)
@Component
public class IndexCommand implements Runnable {

    @Parameters(index = "0", description = "项目根目录路径")
    private Path projectRoot;

    @Option(names = "--lang", description = "目标语言，逗号分隔（如 java,c,python）；默认全部")
    private String languages;

    @Option(names = "--strategy", description = "解析策略：auto（默认）、precise、heuristic")
    private String strategy;

    @Option(names = "--db", description = "增量缓存数据库路径（覆盖 application.yml 配置）")
    private String dbPath;

    @Option(names = "--no-incremental", description = "禁用增量索引，强制全量重新解析")
    private boolean noIncremental;

    private final IndexPipeline indexPipeline;

    /**
     * 通过构造器注入索引管道服务。
     *
     * @param indexPipeline 索引管道实现，不为 {@code null}
     */
    public IndexCommand(IndexPipeline indexPipeline) {
        this.indexPipeline = indexPipeline;
    }

    @Override
    public void run() {
        List<String> langList = languages != null
                ? Arrays.asList(languages.split(","))
                : List.of();

        ParseStrategy parseStrategy = strategy != null
                ? ParseStrategy.valueOf(strategy.toUpperCase())
                : ParseStrategy.AUTO;

        IndexOptions options = new IndexOptions(langList, parseStrategy, !noIncremental, dbPath);
        IndexResult result = indexPipeline.index(projectRoot, options);

        System.err.printf("Indexed %d files (%d units, %d edges) in %d ms%n",
                result.parsedFiles(), result.totalUnits(), result.totalEdges(), result.durationMs());

        if (!result.errors().isEmpty()) {
            result.errors().forEach(e -> System.err.println("[WARN] " + e));
        }
    }
}
