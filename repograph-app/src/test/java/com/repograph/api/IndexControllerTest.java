package com.repograph.api;

import com.repograph.app.pipeline.IndexHistoryStore;
import com.repograph.core.pipeline.IndexPipeline;
import com.repograph.core.pipeline.IndexProgressEvent;
import com.repograph.core.pipeline.IndexResult;
import com.repograph.core.pipeline.IndexStore;
import com.repograph.vuln.VulnStore;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Path;
import java.util.List;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link IndexController} 单元测试，验证项目索引和单文件增量索引端点。
 *
 * @author leolu
 * @since 0.1.0
 */
@WebMvcTest(IndexController.class)
class IndexControllerTest {

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

    private static IndexResult sampleResult(int files, int units) {
        return new IndexResult(files, files, 0, 0, units, 0, 100L, List.of());
    }

    @Test
    void indexProject_returns202Accepted() throws Exception {
        mvc.perform(post("/api/v1/index/project").param("projectRoot", "/tmp/myproject"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("running"));
    }

    @Test
    void indexProject_withLangAndStrategy_returns202() throws Exception {
        mvc.perform(post("/api/v1/index/project")
                        .param("projectRoot", "/tmp/myproject")
                        .param("lang", "java")
                        .param("strategy", "precise"))
                .andExpect(status().isAccepted());
    }

    @Test
    void indexProjectStatus_idle_returnsIdleStatus() throws Exception {
        when(indexHistoryStore.load(anyString())).thenReturn(Optional.empty());
        // 使用从未触发过索引的路径，内存和 SQLite 均无记录，状态应为 idle
        mvc.perform(get("/api/v1/index/project/status").param("projectRoot", "/tmp/never-indexed"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("idle"));
    }

    @Test
    void indexFile_returns200WithResult() throws Exception {
        when(indexPipeline.indexFile(any(Path.class), any(Path.class), any()))
                .thenReturn(sampleResult(1, 8));

        mvc.perform(post("/api/v1/index/file")
                        .param("file", "/tmp/myproject/Foo.java")
                        .param("projectRoot", "/tmp/myproject"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalFiles").value(1))
                .andExpect(jsonPath("$.totalUnits").value(8));
    }

    @Test
    void indexFile_withStrategy_returns200() throws Exception {
        when(indexPipeline.indexFile(any(Path.class), any(Path.class), any()))
                .thenReturn(sampleResult(1, 3));

        mvc.perform(post("/api/v1/index/file")
                        .param("file", "/tmp/myproject/Bar.java")
                        .param("projectRoot", "/tmp/myproject")
                        .param("strategy", "heuristic"))
                .andExpect(status().isOk());
    }

    // ── Progress reporting ────────────────────────────────────────────────────

    @Autowired
    IndexController indexController;

    @Test
    void indexStatus_whileRunning_withProgress_exposesStageAndPct() throws Exception {
        // Block the mock pipeline until we've checked status, so the async task stays "running".
        CountDownLatch block = new CountDownLatch(1);
        when(indexPipeline.index(any(), any())).thenAnswer(inv -> {
            block.await();
            return sampleResult(1, 8);
        });

        // Start async indexing and inject a progress event.
        mvc.perform(post("/api/v1/index/project").param("projectRoot", "/tmp/progress-test2"));
        indexController.onIndexProgress(
                new IndexProgressEvent("/tmp/progress-test2", "embedding", 75, 100));

        // While the pipeline is blocked the status endpoint must include progress fields.
        try {
            mvc.perform(get("/api/v1/index/project/status").param("projectRoot", "/tmp/progress-test2"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.stage").value("embedding"))
                    .andExpect(jsonPath("$.done").value(75))
                    .andExpect(jsonPath("$.total").value(100))
                    .andExpect(jsonPath("$.pct").value(75));
        } finally {
            block.countDown();  // unblock pipeline regardless of assertion outcome
        }
    }

    @Test
    void onIndexProgress_handlerDoesNotThrow() {
        // Verify the @EventListener method is callable without exception
        indexController.onIndexProgress(
                new IndexProgressEvent("/any/path", "parsing", 10, 50));
    }

    @Test
    void deleteProject_returns200AndDelegatesToStore() throws Exception {
        mvc.perform(delete("/api/v1/index/project").param("projectId", "abc123def456"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("deleted"))
                .andExpect(jsonPath("$.projectId").value("abc123def456"));

        verify(indexStore).removeProject("abc123def456");
    }
}
