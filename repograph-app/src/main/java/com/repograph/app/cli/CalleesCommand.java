package com.repograph.app.cli;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.util.List;

/**
 * {@code repograph callees} 子命令，查询指定方法/函数所调用的被调方列表。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
    name = "callees",
    mixinStandardHelpOptions = true,
    description = "查询指定方法/函数所调用的被调方列表"
)
@Component
public class CalleesCommand implements Runnable {

    @Parameters(index = "0", description = "目标方法/函数全限定名")
    private String qualifiedName;

    @Option(names = "--depth", description = "遍历深度（默认 3）", defaultValue = "3")
    private int depth;

    private final GraphQueryService graphQueryService;
    private final ObjectMapper objectMapper;

    /**
     * 通过构造器注入图查询服务和 JSON 序列化工具。
     *
     * @param graphQueryService 图查询服务，不为 {@code null}
     * @param objectMapper      Jackson ObjectMapper，不为 {@code null}
     */
    public CalleesCommand(GraphQueryService graphQueryService, ObjectMapper objectMapper) {
        this.graphQueryService = graphQueryService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        List<CodeUnit> callees = graphQueryService.findCallees(qualifiedName, depth);
        if (callees.isEmpty()) {
            System.out.println("No callees found for: " + qualifiedName);
            return;
        }
        System.err.printf("Found %d callee(s) for '%s' (depth=%d)%n",
            callees.size(), qualifiedName, depth);
        try {
            System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(callees));
        } catch (Exception e) {
            System.err.println("[ERROR] Serialization failed: " + e.getMessage());
        }
    }
}
