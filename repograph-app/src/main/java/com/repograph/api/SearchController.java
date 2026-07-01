package com.repograph.api;

import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.vector.SearchOptions;
import com.repograph.core.vector.SearchResult;
import com.repograph.core.vector.VectorStore;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.repograph.core.vector.SearchPage;

/**
 * 语义和代码相似检索 REST API。
 *
 * <p>语义检索（{@code /search/semantic}）将自然语言查询转换为 embedding 后与 semantic 向量比对；
 * 代码检索（{@code /search/code}）将代码片段转换为 embedding 后与 code 向量比对。
 * 两类检索均支持语言、符号类型、项目和入口点等多维过滤。
 *
 * @author leolu
 * @since 0.1.0
 */
@RestController
@RequestMapping("/api/v1/search")
public class SearchController {

    private final VectorStore vectorStore;

    /**
     * 通过构造器注入向量存储服务。
     *
     * @param vectorStore 向量存储服务，不为 {@code null}
     */
    public SearchController(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    /** 服务端每页结果上限，防止单次查询过大。 */
    private static final int MAX_LIMIT = 100;

    /**
     * 自然语言语义检索，支持分页（{@code offset} + {@code limit}）。
     *
     * @param q         自然语言查询字符串，不为 {@code null}
     * @param lang      按语言过滤；{@code null} 表示不过滤
     * @param kind      按 {@link CodeUnitKind} 名称过滤；{@code null} 表示不过滤
     * @param limit     每页最大结果数，默认 10，上限 {@value MAX_LIMIT}
     * @param offset    结果起始偏移，默认 0
     * @param projectId 按项目 ID 过滤；{@code null} 表示不过滤
     * @param entryOnly 为 {@code true} 时仅返回入口点符号
     * @param noTest    为 {@code true} 时排除测试代码
     * @return 分页检索结果 {@link SearchPage}
     */
    @GetMapping("/semantic")
    public SearchPage semantic(
            @RequestParam String q,
            @RequestParam(required = false) String lang,
            @RequestParam(required = false) String kind,
            @RequestParam(defaultValue = "10") int limit,
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(required = false) String projectId,
            @RequestParam(defaultValue = "false") boolean entryOnly,
            @RequestParam(defaultValue = "false") boolean noTest) {
        SearchOptions opts = new SearchOptions(
            Math.max(1, Math.min(limit, MAX_LIMIT)), offset, lang, parseKind(kind), projectId, entryOnly, noTest
        );
        return vectorStore.semanticSearch(q, opts);
    }

    /**
     * 代码相似检索，支持分页（{@code offset} + {@code limit}）。
     *
     * @param snippet   代码片段字符串，不为 {@code null}
     * @param lang      按语言过滤；{@code null} 表示不过滤
     * @param kind      按 {@link CodeUnitKind} 名称过滤；{@code null} 表示不过滤
     * @param limit     每页最大结果数，默认 10，上限 {@value MAX_LIMIT}
     * @param offset    结果起始偏移，默认 0
     * @param projectId 按项目 ID 过滤；{@code null} 表示不过滤
     * @return 分页检索结果 {@link SearchPage}
     */
    @GetMapping("/code")
    public SearchPage code(
            @RequestParam String snippet,
            @RequestParam(required = false) String lang,
            @RequestParam(required = false) String kind,
            @RequestParam(defaultValue = "10") int limit,
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(required = false) String projectId) {
        SearchOptions opts = new SearchOptions(
            Math.max(1, Math.min(limit, MAX_LIMIT)), offset, lang, parseKind(kind), projectId, false, false
        );
        return vectorStore.codeSearch(snippet, opts);
    }

    private CodeUnitKind parseKind(String kind) {
        if (kind == null || kind.isBlank()) return null;
        try {
            return CodeUnitKind.valueOf(kind.toUpperCase());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
