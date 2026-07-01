package com.repograph.app.watcher;

import java.nio.file.Path;
import java.nio.file.WatchKey;
import java.util.List;

/**
 * 正在被监听的项目条目。{@code keys} 是可变列表，watcher 在发现新子目录时会追加。
 *
 * @param projectId 项目唯一标识符
 * @param root      项目根目录绝对路径
 * @param keys      该项目下所有已注册的 {@link WatchKey}，包含根目录和所有子目录
 */
public record WatchedProject(String projectId, Path root, List<WatchKey> keys) {}
