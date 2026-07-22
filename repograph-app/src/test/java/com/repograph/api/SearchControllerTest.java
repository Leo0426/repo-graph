package com.repograph.api;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.retrieval.KeywordSearchResult;
import com.repograph.core.retrieval.KeywordSearchService;
import com.repograph.core.vector.SearchPage;
import com.repograph.core.vector.SearchResult;
import com.repograph.core.vector.VectorStore;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link SearchController} 单元测试，验证语义检索和代码相似检索端点。
 *
 * @author leolu
 * @since 0.1.0
 */
@WebMvcTest(SearchController.class)
class SearchControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    VectorStore vectorStore;

    @MockBean
    KeywordSearchService keywordSearchService;

    private static CodeUnit sampleUnit() {
        return new CodeUnit("id1", CodeUnitKind.METHOD, "java",
                "com.example.Foo#bar", "bar", "Foo.java",
                1, 10, "void bar() {}", "void bar()",
                List.of(), "com.example.Foo", Map.of());
    }

    private static SearchPage page(SearchResult... results) {
        List<SearchResult> list = List.of(results);
        return new SearchPage(list, 0, 10, false);
    }

    private static SearchPage emptyPage() {
        return new SearchPage(List.of(), 0, 10, false);
    }

    @Test
    void semantic_returnsResults() throws Exception {
        SearchResult result = new SearchResult(sampleUnit(), 0.9f);
        when(vectorStore.semanticSearch(eq("find service"), any())).thenReturn(page(result));

        mvc.perform(get("/api/v1/search/semantic").param("q", "find service"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results.length()").value(1))
                .andExpect(jsonPath("$.results[0].score").value(0.9f))
                .andExpect(jsonPath("$.offset").value(0))
                .andExpect(jsonPath("$.hasMore").value(false));
    }

    @Test
    void semantic_noResults_returnsEmptyPage() throws Exception {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(emptyPage());

        mvc.perform(get("/api/v1/search/semantic").param("q", "nothing here"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results.length()").value(0));
    }

    @Test
    void semantic_withOffsetParam_passedThrough() throws Exception {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(emptyPage());

        mvc.perform(get("/api/v1/search/semantic")
                        .param("q", "test")
                        .param("limit", "5")
                        .param("offset", "10"))
                .andExpect(status().isOk());
    }

    @Test
    void semantic_withKindFilter_parsedCorrectly() throws Exception {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(emptyPage());

        mvc.perform(get("/api/v1/search/semantic")
                        .param("q", "test")
                        .param("kind", "METHOD")
                        .param("limit", "5"))
                .andExpect(status().isOk());
    }

    @Test
    void semantic_invalidKind_ignoredGracefully() throws Exception {
        when(vectorStore.semanticSearch(any(), any())).thenReturn(emptyPage());

        mvc.perform(get("/api/v1/search/semantic")
                        .param("q", "test")
                        .param("kind", "INVALID_KIND"))
                .andExpect(status().isOk());
    }

    @Test
    void code_returnsResults() throws Exception {
        SearchResult result = new SearchResult(sampleUnit(), 0.85f);
        when(vectorStore.codeSearch(eq("void foo() {}"), any())).thenReturn(page(result));

        mvc.perform(get("/api/v1/search/code").param("snippet", "void foo() {}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results.length()").value(1))
                .andExpect(jsonPath("$.results[0].score").value(0.85f));
    }

    @Test
    void code_noResults_returnsEmptyPage() throws Exception {
        when(vectorStore.codeSearch(any(), any())).thenReturn(emptyPage());

        mvc.perform(get("/api/v1/search/code").param("snippet", "int x = 1;"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results.length()").value(0));
    }

    @Test
    void keyword_returnsResults() throws Exception {
        when(keywordSearchService.search(eq("CWE-78 exec"), any()))
                .thenReturn(List.of(new KeywordSearchResult(sampleUnit(), 0.7f, List.of("cwe-78", "exec"))));

        mvc.perform(get("/api/v1/search/keyword")
                        .param("q", "CWE-78 exec")
                        .param("kind", "METHOD"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].score").value(0.7f))
                .andExpect(jsonPath("$[0].matchedTerms[0]").value("cwe-78"));
    }
}
