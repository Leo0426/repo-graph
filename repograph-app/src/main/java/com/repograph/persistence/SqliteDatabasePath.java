package com.repograph.persistence;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * SQLite 文件路径准备，保证存储初始化不依赖其他 Bean 的创建顺序。
 *
 * @author leolu
 */
public final class SqliteDatabasePath {

    private SqliteDatabasePath() {}

    /**
     * 在第一次打开数据库前递归创建父目录，保留已有目录、数据库和调用方配置的路径。
     *
     * @param dbPath SQLite 数据库文件路径
     * @return 原始数据库路径
     * @throws IllegalStateException 父目录无法创建时，包含目标目录和原始文件系统原因
     */
    public static String prepare(String dbPath) {
        Path parent = Path.of(dbPath).toAbsolutePath().getParent();
        try {
            if (parent != null) {
                Files.createDirectories(parent);
            }
            return dbPath;
        } catch (IOException | SecurityException error) {
            throw new IllegalStateException("Cannot create SQLite database directory '" + parent
                    + "' for '" + dbPath + "'. Check directory permissions and conflicting files.", error);
        }
    }
}
