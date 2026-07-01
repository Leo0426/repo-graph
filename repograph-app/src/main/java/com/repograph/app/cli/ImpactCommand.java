package com.repograph.app.cli;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Parameters;

import java.util.Set;

/**
 * {@code repograph impact} 子命令，分析变更指定符号后的影响范围。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
    name = "impact",
    mixinStandardHelpOptions = true,
    description = "分析变更指定符号后的影响范围（受影响的调用方、子类等）"
)
@Component
public class ImpactCommand implements Runnable {

    @Parameters(index = "0", description = "目标符号全限定名")
    private String qualifiedName;

    private final GraphQueryService graphQueryService;
    private final ObjectMapper objectMapper;

    /**
     * 通过构造器注入图查询服务和 JSON 序列化工具。
     *
     * @param graphQueryService 图查询服务，不为 {@code null}
     * @param objectMapper      Jackson ObjectMapper，不为 {@code null}
     */
    public ImpactCommand(GraphQueryService graphQueryService, ObjectMapper objectMapper) {
        this.graphQueryService = graphQueryService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        Set<CodeUnit> impacted = graphQueryService.impactAnalysis(qualifiedName);
        if (impacted.isEmpty()) {
            System.out.println("No impact found for: " + qualifiedName);
            return;
        }
        System.err.printf("Found %d impacted unit(s) for '%s'%n", impacted.size(), qualifiedName);
        try {
            System.out.println(objectMapper.writerWithDefaultPrettyPrinter()
                .writeValueAsString(impacted));
        } catch (Exception e) {
            System.err.println("[ERROR] Serialization failed: " + e.getMessage());
        }
    }
}
