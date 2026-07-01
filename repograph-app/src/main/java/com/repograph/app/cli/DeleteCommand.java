package com.repograph.app.cli;

import com.repograph.core.pipeline.IndexStore;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

/**
 * {@code repograph delete <projectId>} 子命令，删除指定 projectId 在 Neo4j、Qdrant 和 SQLite
 * 缓存中的全部索引数据。默认要求 {@code --yes} 显式确认以防误操作。
 *
 * @author leolu
 * @since 0.2.0
 */
@Command(
    name = "delete",
    mixinStandardHelpOptions = true,
    description = "删除指定项目的所有索引数据（Neo4j 节点、Qdrant 向量、增量缓存）"
)
@Component
public class DeleteCommand implements Runnable {

    @Parameters(index = "0", description = "目标 projectId（12 字符前缀）")
    private String projectId;

    @Option(names = {"-y", "--yes"}, description = "跳过交互确认，直接执行删除")
    private boolean yes;

    private final IndexStore indexStore;

    /**
     * 通过构造器注入存储协调器。
     *
     * @param indexStore 存储协调器，不为 {@code null}
     */
    public DeleteCommand(IndexStore indexStore) {
        this.indexStore = indexStore;
    }

    @Override
    public void run() {
        if (projectId == null || projectId.isBlank()) {
            System.err.println("[ERROR] projectId is required");
            return;
        }
        if (!yes) {
            System.err.printf("About to delete all data for project '%s'.%n", projectId);
            System.err.println("Re-run with --yes to confirm.");
            return;
        }
        indexStore.removeProject(projectId);
        System.out.printf("Deleted project '%s'%n", projectId);
    }
}
