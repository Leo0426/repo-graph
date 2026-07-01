package com.repograph.app.cli;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.vector.VectorStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.util.Optional;

/**
 * {@code repograph locate} 子命令，按文件路径和行号定位包含该行的最小粒度代码单元。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
    name = "locate",
    mixinStandardHelpOptions = true,
    description = "按文件路径和行号定位代码单元（返回包含该行的最小粒度符号）"
)
@Component
public class LocateCommand implements Runnable {

    @Option(names = "--file", required = true, description = "源文件相对路径")
    private String file;

    @Option(names = "--line", required = true, description = "目标行号（1-based）")
    private int line;

    private final VectorStore vectorStore;
    private final ObjectMapper objectMapper;

    /**
     * 通过构造器注入向量存储和 JSON 序列化工具。
     *
     * @param vectorStore  向量存储服务，不为 {@code null}
     * @param objectMapper Jackson ObjectMapper，不为 {@code null}
     */
    public LocateCommand(VectorStore vectorStore, ObjectMapper objectMapper) {
        this.vectorStore = vectorStore;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        Optional<CodeUnit> result = vectorStore.locateByPosition(file, line);
        if (result.isEmpty()) {
            System.err.printf("No symbol found at %s:%d%n", file, line);
            return;
        }
        try {
            System.out.println(objectMapper.writerWithDefaultPrettyPrinter()
                .writeValueAsString(result.get()));
        } catch (Exception e) {
            System.err.println("[ERROR] Serialization failed: " + e.getMessage());
        }
    }
}
