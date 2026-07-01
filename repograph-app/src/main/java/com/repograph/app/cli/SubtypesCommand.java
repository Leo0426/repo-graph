package com.repograph.app.cli;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Parameters;

import java.util.List;

/**
 * {@code repograph subtypes} 子命令，查询指定类/接口的所有子类型（实现类和子类）。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
    name = "subtypes",
    mixinStandardHelpOptions = true,
    description = "查询指定类/接口的所有子类型（实现类和子类）"
)
@Component
public class SubtypesCommand implements Runnable {

    @Parameters(index = "0", description = "目标类/接口全限定名")
    private String qualifiedName;

    private final GraphQueryService graphQueryService;
    private final ObjectMapper objectMapper;

    /**
     * 通过构造器注入图查询服务和 JSON 序列化工具。
     *
     * @param graphQueryService 图查询服务，不为 {@code null}
     * @param objectMapper      Jackson ObjectMapper，不为 {@code null}
     */
    public SubtypesCommand(GraphQueryService graphQueryService, ObjectMapper objectMapper) {
        this.graphQueryService = graphQueryService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        List<CodeUnit> subtypes = graphQueryService.findSubTypes(qualifiedName);
        if (subtypes.isEmpty()) {
            System.out.println("No subtypes found for: " + qualifiedName);
            return;
        }
        System.err.printf("Found %d subtype(s) for '%s'%n", subtypes.size(), qualifiedName);
        try {
            System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(subtypes));
        } catch (Exception e) {
            System.err.println("[ERROR] Serialization failed: " + e.getMessage());
        }
    }
}
