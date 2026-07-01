package com.repograph.api;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.vector.VectorStore;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link SymbolController} 单元测试，验证按全限定名查找和按位置定位端点。
 *
 * @author leolu
 * @since 0.1.0
 */
@WebMvcTest(SymbolController.class)
class SymbolControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    VectorStore vectorStore;

    private static CodeUnit sampleUnit() {
        return new CodeUnit("id1", CodeUnitKind.CLASS, "java",
                "com.example.Foo", "Foo", "Foo.java",
                1, 20, "class Foo {}", "class Foo",
                List.of(), null, Map.of());
    }

    @Test
    void symbol_found_returns200() throws Exception {
        when(vectorStore.symbolLookup("com.example.Foo")).thenReturn(Optional.of(sampleUnit()));

        mvc.perform(get("/api/v1/symbol/com.example.Foo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.qualifiedName").value("com.example.Foo"));
    }

    @Test
    void symbol_notFound_returns404() throws Exception {
        when(vectorStore.symbolLookup("com.example.Missing")).thenReturn(Optional.empty());

        mvc.perform(get("/api/v1/symbol/com.example.Missing"))
                .andExpect(status().isNotFound());
    }

    @Test
    void locate_found_returns200() throws Exception {
        when(vectorStore.locateByPosition("Foo.java", 5)).thenReturn(Optional.of(sampleUnit()));

        mvc.perform(get("/api/v1/locate")
                        .param("file", "Foo.java")
                        .param("line", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.simpleName").value("Foo"));
    }

    @Test
    void locate_notFound_returns404() throws Exception {
        when(vectorStore.locateByPosition("Foo.java", 999)).thenReturn(Optional.empty());

        mvc.perform(get("/api/v1/locate")
                        .param("file", "Foo.java")
                        .param("line", "999"))
                .andExpect(status().isNotFound());
    }
}
