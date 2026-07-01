package com.repograph.app.watcher;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import com.repograph.core.pipeline.IndexPipeline;
import com.repograph.core.pipeline.IndexStore;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@link FileWatcherService} 单元测试。
 *
 * <p>验证项目注册、注销、状态查询和启动时恢复逻辑；不测试实际文件事件触发
 * （依赖 OS 的 WatchService 异步行为，不适合单元测试）。
 *
 * @author leolu
 * @since 0.4.0
 */
@ExtendWith(MockitoExtension.class)
class FileWatcherServiceTest {

    @Mock IndexPipeline indexPipeline;
    @Mock IndexStore indexStore;
    @Mock GraphQueryService graphQueryService;

    @TempDir Path tempDir;

    private FileWatcherService service;

    @BeforeEach
    void setUp() throws Exception {
        service = new FileWatcherService(indexPipeline, indexStore, graphQueryService);
        service.init();
    }

    @AfterEach
    void tearDown() {
        service.shutdown();
    }

    // ── start / list / isWatching ─────────────────────────────────────────────

    @Test
    void start_registersProject() {
        service.start("abc123", tempDir);

        assertThat(service.isWatching("abc123")).isTrue();
        assertThat(service.list()).extracting(WatchedProject::projectId).containsExactly("abc123");
    }

    @Test
    void start_idempotent_doesNotDuplicateEntry() {
        service.start("abc123", tempDir);
        service.start("abc123", tempDir);

        assertThat(service.list()).hasSize(1);
    }

    @Test
    void start_nonExistentRoot_silentlyIgnored() {
        service.start("ghost", Path.of("/nonexistent/path/that/does/not/exist"));

        assertThat(service.isWatching("ghost")).isFalse();
    }

    // ── stop ──────────────────────────────────────────────────────────────────

    @Test
    void stop_removesRegistration() {
        service.start("abc123", tempDir);
        service.stop("abc123");

        assertThat(service.isWatching("abc123")).isFalse();
        assertThat(service.list()).isEmpty();
    }

    @Test
    void stop_unknownProject_idempotent() {
        service.stop("nonexistent-project");
        // must not throw
    }

    // ── list ──────────────────────────────────────────────────────────────────

    @Test
    void list_multipleProjects_returnsAll() throws Exception {
        java.nio.file.Path dirA = tempDir.resolve("projA");
        java.nio.file.Path dirB = tempDir.resolve("projB");
        java.nio.file.Files.createDirectories(dirA);
        java.nio.file.Files.createDirectories(dirB);

        service.start("projA", dirA);
        service.start("projB", dirB);

        assertThat(service.list()).extracting(WatchedProject::projectId)
                .containsExactlyInAnyOrder("projA", "projB");
    }

    @Test
    void list_empty_whenNothingRegistered() {
        assertThat(service.list()).isEmpty();
    }

    // ── restoreWatchers ───────────────────────────────────────────────────────

    @Test
    void restoreWatchers_registersProjectsWithExistingRoots() {
        when(graphQueryService.listProjects()).thenReturn(
                List.of(new ProjectInfo("abc123", tempDir.toString(), 10L, "2025-01-01T00:00:00")));

        service.restoreWatchers();

        assertThat(service.isWatching("abc123")).isTrue();
    }

    @Test
    void restoreWatchers_skipsProjectsWithMissingRoot() {
        when(graphQueryService.listProjects()).thenReturn(
                List.of(new ProjectInfo("ghost", "/does/not/exist", 5L, "")));

        service.restoreWatchers();

        assertThat(service.isWatching("ghost")).isFalse();
    }

    @Test
    void restoreWatchers_skipsProjectsWithBlankRoot() {
        when(graphQueryService.listProjects()).thenReturn(
                List.of(new ProjectInfo("blank", "", 0L, "")));

        service.restoreWatchers();

        assertThat(service.list()).isEmpty();
    }

    @Test
    void restoreWatchers_graphServiceThrows_doesNotPropagate() {
        when(graphQueryService.listProjects()).thenThrow(new RuntimeException("Neo4j unavailable"));

        // must not throw
        service.restoreWatchers();
    }

    @Test
    void restoreWatchers_emptyRegistry_noWatchersAdded() {
        when(graphQueryService.listProjects()).thenReturn(List.of());

        service.restoreWatchers();

        assertThat(service.list()).isEmpty();
    }
}
