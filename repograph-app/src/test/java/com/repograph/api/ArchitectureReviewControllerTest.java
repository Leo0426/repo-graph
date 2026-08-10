package com.repograph.api;

import com.repograph.core.architecture.ArchitectureReviewResult;
import com.repograph.core.architecture.ArchitectureReviewService;
import com.repograph.core.architecture.ArchitectureReviewStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.function.Consumer;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link ArchitectureReviewController} REST 契约测试。
 *
 * @author leolu
 */
@WebMvcTest(ArchitectureReviewController.class)
class ArchitectureReviewControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    ArchitectureReviewService reviewService;

    @MockitoBean(name = "architectureReviewExecutor")
    ExecutorService executor;

    @Test
    void reviewReturnsAuditableModelStatus() throws Exception {
        when(reviewService.review("project-a")).thenReturn(new ArchitectureReviewResult(
                "project-a", ArchitectureReviewStatus.COMPLETED, "FORGEFLOW_ARCHITECTURE_U1-U8@0.2.1",
                "OLLAMA / qwen3:8b", "2026-08-10T10:00:00Z", List.of("观察"), List.of(), List.of(), List.of()));

        mvc.perform(post("/api/v1/architecture/reviews").param("projectId", "project-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").value("project-a"))
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.methodology").value("FORGEFLOW_ARCHITECTURE_U1-U8@0.2.1"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void streamingReviewEmitsDeltaBeforeFinalResult() throws Exception {
        ArchitectureReviewResult result = new ArchitectureReviewResult(
                "project-a", ArchitectureReviewStatus.COMPLETED, "FORGEFLOW_ARCHITECTURE_U1-U8@0.2.1",
                "OLLAMA / qwen3:8b", "2026-08-10T10:00:00Z", List.of("观察"), List.of(), List.of(), List.of());
        doAnswer(invocation -> {
            invocation.getArgument(0, Runnable.class).run();
            return null;
        }).when(executor).execute(any(Runnable.class));
        when(reviewService.reviewStreaming(eq("project-a"), any())).thenAnswer(invocation -> {
            Consumer<String> consumer = invocation.getArgument(1, Consumer.class);
            consumer.accept("{\"observations\":[");
            return result;
        });

        MvcResult stream = mvc.perform(get("/api/v1/architecture/reviews/stream")
                        .param("projectId", "project-a"))
                .andExpect(request().asyncStarted())
                .andReturn();

        mvc.perform(asyncDispatch(stream))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("event:delta")))
                .andExpect(content().string(containsString("event:result")))
                .andExpect(content().string(containsString("event:complete")));
    }
}
