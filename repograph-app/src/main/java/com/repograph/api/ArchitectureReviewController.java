package com.repograph.api;

import com.repograph.core.architecture.ArchitectureReviewResult;
import com.repograph.core.architecture.ArchitectureReviewService;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Map;
import java.util.concurrent.ExecutorService;

/**
 * 架构漂移与变更风险评审 REST 入口。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/architecture")
public class ArchitectureReviewController {

    private final ArchitectureReviewService reviewService;
    private final ExecutorService executor;

    /**
     * 创建架构评审控制器。
     *
     * @param reviewService 架构评审接口
     * @param executor      架构评审专用执行器
     */
    public ArchitectureReviewController(
            ArchitectureReviewService reviewService,
            @Qualifier("architectureReviewExecutor") ExecutorService executor) {
        this.reviewService = reviewService;
        this.executor = executor;
    }

    /**
     * 生成项目架构风险事实与模型辅助建议。
     *
     * @param projectId 项目 ID
     * @return 架构评审结果
     */
    @PostMapping("/reviews")
    public ArchitectureReviewResult review(@RequestParam String projectId) {
        return reviewService.review(projectId);
    }

    /**
     * 以 SSE 转发 Ollama 公开输出增量，并在末尾发送完整结构化结果。
     *
     * @param projectId 项目 ID
     * @return SSE emitter
     */
    @GetMapping(path = "/reviews/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter reviewStreaming(@RequestParam String projectId) {
        SseEmitter emitter = new SseEmitter(195_000L);
        executor.execute(() -> streamReview(projectId, emitter));
        return emitter;
    }

    private void streamReview(String projectId, SseEmitter emitter) {
        try {
            send(emitter, "phase", Map.of("phase", "EVIDENCE_READY"));
            ArchitectureReviewResult result = reviewService.reviewStreaming(
                    projectId, delta -> sendUnchecked(emitter, "delta", delta));
            send(emitter, "result", result);
            send(emitter, "complete", Map.of("status", result.status().name()));
            emitter.complete();
        } catch (RuntimeException | IOException error) {
            try {
                send(emitter, "stream-error", Map.of(
                        "message", error.getMessage() == null ? "架构评审流中断" : error.getMessage()));
            } catch (IOException ignored) {
                // 客户端已经断开，无需再次写入。
            }
            emitter.completeWithError(error);
        }
    }

    private static void sendUnchecked(SseEmitter emitter, String event, Object data) {
        try {
            send(emitter, event, data);
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    private static void send(SseEmitter emitter, String event, Object data) throws IOException {
        emitter.send(SseEmitter.event().name(event).data(data));
    }
}
