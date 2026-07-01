package com.repograph.core.util;

import java.nio.file.Path;

/**
 * 文件路径规范化工具类，确保所有模块使用统一的相对路径格式存储 filePath。
 *
 * <p>所有模块禁止自行实现路径转换，必须调用此类，以保证 Qdrant Payload、
 * 图 JSON 和 SQLite 缓存中的 filePath 字段跨平台一致（统一使用 {@code /} 分隔符）。
 *
 * @author leolu
 * @since 0.1.0
 */
public final class PathUtil {

    private PathUtil() {}

    /**
     * 将文件绝对路径转换为相对于项目根目录的相对路径，并统一使用 {@code /} 分隔符。
     *
     * <p>Windows 平台下路径分隔符 {@code \} 会被替换为 {@code /}，确保跨平台一致性。
     * 示例：{@code projectRoot=/home/leolu/myapp}，{@code file=/home/leolu/myapp/src/Foo.java}
     * → {@code "src/Foo.java"}
     *
     * @param projectRoot 项目根目录路径，不为 {@code null}
     * @param file        待转换的文件路径，必须位于 {@code projectRoot} 之下，不为 {@code null}
     * @return 相对于 {@code projectRoot} 的路径字符串，使用 {@code /} 分隔符
     * @throws IllegalArgumentException 若 {@code file} 不在 {@code projectRoot} 之下
     */
    public static String toRelativePath(Path projectRoot, Path file) {
        return projectRoot.toAbsolutePath().normalize()
                .relativize(file.toAbsolutePath().normalize())
                .toString()
                .replace('\\', '/');
    }
}
