package com.repograph.api;

import com.repograph.app.pipeline.IndexHistoryStore;
import com.repograph.core.asset.AssetImportService;
import com.repograph.core.finding.TriageDataCleanup;
import com.repograph.core.pipeline.IndexPipeline;
import com.repograph.core.pipeline.IndexStore;
import com.repograph.core.vector.VectorStore;
import com.repograph.vuln.VulnStore;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Path;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link GlobalExceptionHandler} 单元测试，验证各类请求异常被正确转换为结构化 HTTP 错误响应。
 *
 * @author leolu
 * @since 0.1.0
 */
@WebMvcTest({IndexController.class, SymbolController.class})
class GlobalExceptionHandlerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    IndexPipeline indexPipeline;

    @MockBean
    IndexStore indexStore;

    @MockBean
    IndexHistoryStore indexHistoryStore;

    @MockBean
    VulnStore vulnStore;

    @MockBean
    VectorStore vectorStore;

    @MockBean
    AssetImportService assetImportService;

    @MockBean
    TriageDataCleanup triageDataCleanup;

    @Test
    void invalidStrategy_returns400() throws Exception {
        mvc.perform(post("/api/v1/index/project")
                        .param("projectRoot", "/tmp/project")
                        .param("strategy", "INVALID_STRATEGY"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void missingRequiredParam_returns400() throws Exception {
        mvc.perform(get("/api/v1/locate").param("line", "5"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Missing required parameter: file"));
    }

    @Test
    void typeMismatch_returns400() throws Exception {
        mvc.perform(get("/api/v1/locate")
                        .param("file", "Foo.java")
                        .param("line", "not-a-number"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void runtimeException_returns500() throws Exception {
        // POST /project 是异步的，异常不传播到 HTTP 响应；
        // 用同步的 POST /file 端点触发 500
        when(indexPipeline.indexFile(any(Path.class), any(Path.class), any()))
                .thenThrow(new RuntimeException("unexpected failure"));

        mvc.perform(post("/api/v1/index/file")
                        .param("file", "/tmp/project/Foo.java")
                        .param("projectRoot", "/tmp/project"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error").value("Internal server error"));
    }
}
