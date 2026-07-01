package com.repograph.app.cli;

import com.repograph.app.watcher.FileWatcherService;
import com.repograph.app.watcher.WatchedProject;
import com.repograph.core.util.ProjectIdUtil;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.nio.file.Path;
import java.util.List;

/**
 * {@code repograph watch} 子命令，管理文件系统监听。
 *
 * <p>用法：
 * <pre>
 *   repograph watch &lt;path&gt;           # 开始监听，文件变更后自动增量重索引（阻塞进程）
 *   repograph watch --list            # 列出正在监听的项目
 *   repograph watch --stop &lt;pid&gt;     # 停止监听指定 projectId
 * </pre>
 *
 * @author leolu
 * @since 0.4.0
 */
@Command(
        name = "watch",
        mixinStandardHelpOptions = true,
        description = "监听项目目录变更，文件修改后自动触发增量重索引"
)
@Component
public class WatchCommand implements Runnable {

    @Parameters(index = "0", arity = "0..1",
            description = "项目根目录路径；提供时启动监听并阻塞进程（Ctrl-C 退出）")
    private Path projectRoot;

    @Option(names = "--list", description = "列出所有正在监听的项目")
    private boolean list;

    @Option(names = "--stop", description = "停止监听指定 projectId",
            paramLabel = "<projectId>")
    private String stopProjectId;

    private final FileWatcherService watcherService;

    public WatchCommand(FileWatcherService watcherService) {
        this.watcherService = watcherService;
    }

    @Override
    public void run() {
        if (list) {
            printList();
        } else if (stopProjectId != null) {
            watcherService.stop(stopProjectId);
            System.out.printf("Stopped watching '%s'%n", stopProjectId);
        } else if (projectRoot != null) {
            String projectId = ProjectIdUtil.generateProjectId(projectRoot);
            watcherService.start(projectId, projectRoot.toAbsolutePath().normalize());
            System.out.printf("[repograph watch] Watching '%s' (project: %s)%n", projectRoot, projectId);
            System.out.println("[repograph watch] Press Ctrl-C to stop.");
            awaitInterrupt();
        } else {
            System.err.println("Usage: repograph watch <path> | --list | --stop <projectId>");
            System.err.println("Run 'repograph watch --help' for details.");
        }
    }

    private void printList() {
        List<WatchedProject> projects = watcherService.list();
        if (projects.isEmpty()) {
            System.out.println("No projects currently being watched.");
            return;
        }
        System.out.printf("%-14s  %s%n", "PROJECT ID", "ROOT");
        System.out.println("-".repeat(60));
        projects.forEach(wp -> System.out.printf("%-14s  %s%n", wp.projectId(), wp.root()));
    }

    private static void awaitInterrupt() {
        try {
            Thread.currentThread().join();
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }
}
