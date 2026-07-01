package com.repograph.app.watcher;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * 文件监听管理 REST API。
 *
 * <p>监听启动后，项目目录下的文件变更会在
 * {@value FileWatcherService#DEBOUNCE_MILLIS}ms 防抖窗口后自动触发增量重索引。
 *
 * @author leolu
 * @since 0.4.0
 */
@RestController
@RequestMapping("/api/v1/watch")
public class WatchController {

    private final FileWatcherService watcherService;

    public WatchController(FileWatcherService watcherService) {
        this.watcherService = watcherService;
    }

    /**
     * 列出当前正在监听的所有项目。
     *
     * @return 监听条目列表，每条包含 {@code projectId} 和 {@code root}
     */
    @GetMapping
    public List<Map<String, String>> list() {
        return watcherService.list().stream()
                .map(wp -> Map.of("projectId", wp.projectId(), "root", wp.root().toString()))
                .toList();
    }

    /**
     * 开始监听指定项目。已在监听的项目幂等处理（返回 200）。
     *
     * @param projectId 项目唯一标识符
     * @param root      项目根目录绝对路径
     * @return {@code {status, projectId}}
     */
    @PostMapping
    public ResponseEntity<Map<String, String>> start(
            @RequestParam String projectId,
            @RequestParam String root) {
        watcherService.start(projectId, Path.of(root));
        return ResponseEntity.ok(Map.of("status", "watching", "projectId", projectId));
    }

    /**
     * 停止监听指定项目。项目不存在时幂等处理（返回 204）。
     *
     * @param projectId 项目唯一标识符
     */
    @DeleteMapping("/{projectId}")
    public ResponseEntity<Void> stop(@PathVariable String projectId) {
        watcherService.stop(projectId);
        return ResponseEntity.noContent().build();
    }

    /**
     * 查询指定项目是否正在被监听。
     *
     * @param projectId 项目唯一标识符
     * @return {@code {watching: true/false}}
     */
    @GetMapping("/{projectId}")
    public Map<String, Object> status(@PathVariable String projectId) {
        return Map.of("projectId", projectId, "watching", watcherService.isWatching(projectId));
    }
}
