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
 * {@code repograph callers} 子命令，查询调用指定方法/函数的调用方列表。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
    name = "callers",
    mixinStandardHelpOptions = true,
    description = "查询调用指定方法/函数的调用方列表"
)
@Component
public class CallersCommand implements Runnable {

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
    public CallersCommand(GraphQueryService graphQueryService, ObjectMapper objectMapper) {
        this.graphQueryService = graphQueryService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        List<CodeUnit> callers = graphQueryService.findCallers(qualifiedName, depth);
        if (callers.isEmpty()) {
            System.out.println("No callers found for: " + qualifiedName);
            return;
        }
        System.err.printf("Found %d caller(s) for '%s' (depth=%d)%n",
            callers.size(), qualifiedName, depth);
        try {
            System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(callers));
        } catch (Exception e) {
            System.err.println("[ERROR] Serialization failed: " + e.getMessage());
        }
    }
}
