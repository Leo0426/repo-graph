package com.repograph.app.cli;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.vector.VectorStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Parameters;

import java.util.Optional;

/**
 * {@code repograph symbol} 子命令，按全限定名精确查找代码单元。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
    name = "symbol",
    mixinStandardHelpOptions = true,
    description = "按全限定名精确查找代码单元"
)
@Component
public class SymbolCommand implements Runnable {

    @Parameters(index = "0", description = "全限定名，方法使用 # 分隔，如 com.example.Foo#bar")
    private String qualifiedName;

    private final VectorStore vectorStore;
    private final ObjectMapper objectMapper;

    /**
     * 通过构造器注入向量存储和 JSON 序列化工具。
     *
     * @param vectorStore  向量存储服务，不为 {@code null}
     * @param objectMapper Jackson ObjectMapper，不为 {@code null}
     */
    public SymbolCommand(VectorStore vectorStore, ObjectMapper objectMapper) {
        this.vectorStore = vectorStore;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        Optional<CodeUnit> result = vectorStore.symbolLookup(qualifiedName);
        if (result.isEmpty()) {
            System.err.println("Symbol not found: " + qualifiedName);
            return;
        }
        try {
            System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(result.get()));
        } catch (Exception e) {
            System.err.println("[ERROR] Serialization failed: " + e.getMessage());
        }
    }
}
