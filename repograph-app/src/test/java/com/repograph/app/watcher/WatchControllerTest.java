package com.repograph.app.watcher;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link WatchController} 单元测试，验证 REST 端点的委派和响应格式。
 *
 * @author leolu
 * @since 0.4.0
 */
@ExtendWith(MockitoExtension.class)
class WatchControllerTest {

    @Mock FileWatcherService watcherService;

    @TempDir Path tempDir;

    private WatchController controller;

    @BeforeEach
    void setUp() {
        controller = new WatchController(watcherService);
    }

    // ── GET /api/v1/watch ─────────────────────────────────────────────────────

    @Test
    void list_emptyWatchers_returnsEmptyList() {
        when(watcherService.list()).thenReturn(List.of());

        List<Map<String, String>> result = controller.list();

        assertThat(result).isEmpty();
    }

    @Test
    void list_withWatchers_returnsProjectIdAndRoot() {
        when(watcherService.list()).thenReturn(List.of(
                new WatchedProject("abc123", Path.of("/project/root"), List.of())));

        List<Map<String, String>> result = controller.list();

        assertThat(result).hasSize(1);
        assertThat(result.get(0)).containsEntry("projectId", "abc123")
                                  .containsEntry("root", "/project/root");
    }

    // ── POST /api/v1/watch ────────────────────────────────────────────────────

    @Test
    void start_delegatesToServiceAndReturns200() {
        ResponseEntity<Map<String, String>> resp = controller.start("abc123", tempDir.toString());

        verify(watcherService).start("abc123", Path.of(tempDir.toString()));
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(resp.getBody()).containsEntry("status", "watching")
                                   .containsEntry("projectId", "abc123");
    }

    // ── DELETE /api/v1/watch/{projectId} ──────────────────────────────────────

    @Test
    void stop_delegatesToServiceAndReturns204() {
        ResponseEntity<Void> resp = controller.stop("abc123");

        verify(watcherService).stop("abc123");
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    }

    // ── GET /api/v1/watch/{projectId} ─────────────────────────────────────────

    @Test
    void status_watching_returnsTrue() {
        when(watcherService.isWatching("abc123")).thenReturn(true);

        Map<String, Object> result = controller.status("abc123");

        assertThat(result).containsEntry("projectId", "abc123")
                           .containsEntry("watching", true);
    }

    @Test
    void status_notWatching_returnsFalse() {
        when(watcherService.isWatching("abc123")).thenReturn(false);

        Map<String, Object> result = controller.status("abc123");

        assertThat(result).containsEntry("watching", false);
    }
}
