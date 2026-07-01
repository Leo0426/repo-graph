package com.repograph.api;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link FrameworkController} 单元测试，验证框架入口点查询端点。
 *
 * @author leolu
 * @since 0.1.0
 */
@WebMvcTest(FrameworkController.class)
class FrameworkControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    GraphQueryService graphQueryService;

    private static CodeUnit entryPoint(String qn) {
        return new CodeUnit("id-" + qn, CodeUnitKind.CLASS, "java",
                qn, qn, "Foo.java", 1, 50, "", qn,
                List.of("@RestController"), null,
                Map.of("is_entry_point", "true", "framework", "spring"));
    }

    @Test
    void frameworks_returnsEntryPoints() throws Exception {
        when(graphQueryService.findEntryPoints("proj123"))
                .thenReturn(List.of(entryPoint("com.example.UserController")));

        mvc.perform(get("/api/v1/frameworks/proj123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].qualifiedName").value("com.example.UserController"));
    }

    @Test
    void frameworks_noEntryPoints_returnsEmptyList() throws Exception {
        when(graphQueryService.findEntryPoints("proj999")).thenReturn(List.of());

        mvc.perform(get("/api/v1/frameworks/proj999"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void frameworks_multipleEntryPoints_returnsAll() throws Exception {
        when(graphQueryService.findEntryPoints("proj123"))
                .thenReturn(List.of(
                        entryPoint("com.example.UserController"),
                        entryPoint("com.example.OrderController")));

        mvc.perform(get("/api/v1/frameworks/proj123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void frameworks_responseContainsMetadataFields() throws Exception {
        when(graphQueryService.findEntryPoints("proj123"))
                .thenReturn(List.of(entryPoint("com.example.UserController")));

        mvc.perform(get("/api/v1/frameworks/proj123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].metadata.is_entry_point").value("true"))
                .andExpect(jsonPath("$[0].metadata.framework").value("spring"));
    }

    @Test
    void frameworks_usesProjectIdFromPath() throws Exception {
        when(graphQueryService.findEntryPoints("my-project-id")).thenReturn(List.of());

        mvc.perform(get("/api/v1/frameworks/my-project-id"))
                .andExpect(status().isOk());

        org.mockito.Mockito.verify(graphQueryService).findEntryPoints("my-project-id");
    }
}
