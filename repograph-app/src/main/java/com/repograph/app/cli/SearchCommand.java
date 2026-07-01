package com.repograph.app.cli;

import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.vector.SearchOptions;
import com.repograph.core.vector.SearchResult;
import com.repograph.core.vector.VectorStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.util.List;

/**
 * {@code repograph search} 子命令，对已索引项目执行语义或代码相似检索。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
    name = "search",
    mixinStandardHelpOptions = true,
    description = "对已索引项目执行语义（NL）或代码相似检索"
)
@Component
public class SearchCommand implements Runnable {

    @Parameters(index = "0", description = "查询字符串（自然语言或代码片段）")
    private String query;

    @Option(names = "--mode", description = "检索模式：semantic（默认）或 code", defaultValue = "semantic")
    private String mode;

    @Option(names = "--lang", description = "按语言过滤，如 java、c、python")
    private String lang;

    @Option(names = "--kind", description = "按符号类型过滤，如 METHOD、CLASS、FUNCTION")
    private String kind;

    @Option(names = "--limit", description = "每页最大返回结果数（默认 10）", defaultValue = "10")
    private int limit;

    @Option(names = "--offset", description = "跳过前 N 条结果（用于翻页，默认 0）", defaultValue = "0")
    private int offset;

    @Option(names = "--project", description = "项目 ID 过滤")
    private String projectId;

    @Option(names = "--entry-only", description = "仅返回入口点符号")
    private boolean entryOnly;

    @Option(names = "--no-test", description = "排除测试代码")
    private boolean noTest;

    @Option(names = "--format", description = "输出格式：table（默认）或 json", defaultValue = "table")
    private String format;

    private final VectorStore vectorStore;
    private final ObjectMapper objectMapper;

    /**
     * 通过构造器注入向量存储和 JSON 序列化工具。
     *
     * @param vectorStore  向量存储服务，不为 {@code null}
     * @param objectMapper Jackson ObjectMapper，不为 {@code null}
     */
    public SearchCommand(VectorStore vectorStore, ObjectMapper objectMapper) {
        this.vectorStore = vectorStore;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run() {
        CodeUnitKind parsedKind = null;
        if (kind != null && !kind.isBlank()) {
            try {
                parsedKind = CodeUnitKind.valueOf(kind.toUpperCase());
            } catch (IllegalArgumentException e) {
                System.err.println("[WARN] Unknown kind '" + kind + "', ignoring filter");
            }
        }

        SearchOptions opts = new SearchOptions(limit, offset, lang, parsedKind, projectId, entryOnly, noTest);
        var page = "code".equalsIgnoreCase(mode)
                ? vectorStore.codeSearch(query, opts)
                : vectorStore.semanticSearch(query, opts);
        List<SearchResult> results = page.results();
        if (page.hasMore()) {
            System.err.printf("[info] Showing %d result(s) starting at offset %d. Use --offset %d for next page.%n",
                    results.size(), offset, offset + results.size());
        }

        if ("json".equalsIgnoreCase(format)) {
            printJson(results);
        } else {
            printTable(results);
        }
    }

    private void printTable(List<SearchResult> results) {
        if (results.isEmpty()) {
            System.out.println("No results found.");
            return;
        }
        System.out.printf("%-8s %-12s %-10s %-60s%n", "SCORE", "KIND", "LANG", "QUALIFIED_NAME");
        System.out.println("-".repeat(95));
        for (SearchResult r : results) {
            System.out.printf("%.4f   %-12s %-10s %-60s%n",
                r.score(),
                r.unit().kind(),
                r.unit().language(),
                r.unit().qualifiedName()
            );
        }
    }

    private void printJson(List<SearchResult> results) {
        try {
            System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(results));
        } catch (Exception e) {
            System.err.println("[ERROR] Failed to serialize results: " + e.getMessage());
        }
    }
}
