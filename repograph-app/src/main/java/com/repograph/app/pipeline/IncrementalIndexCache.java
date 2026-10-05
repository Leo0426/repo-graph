package com.repograph.app.pipeline;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 基于 SQLite 的增量索引缓存，通过比对文件 MD5 跳过未变更文件。
 *
 * <p>缓存数据库存储于 {@code repograph.index.db-path}（默认 {@code ~/.repograph/index.db}），
 * {@code file_cache} 记录文件相对路径、所属项目 ID 和 MD5；空 MD5 表示未完成的索引或清理。
 * {@code pending_project_deletions} 保留跨存储项目删除的重试标记。
 *
 * <p>数据库文件和父目录不存在时自动创建，不需要外部预建目录。
 *
 * <p>连接管理策略：每次批量操作开一个连接，操作完即关闭（try-with-resources）。
 * {@link #filterChanged} 用单连接 + IN 子句批量查询，避免每文件开一次连接。
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class IncrementalIndexCache {

    private static final Logger log = LoggerFactory.getLogger(IncrementalIndexCache.class);

    private final String dbPath;

    /**
     * 通过构造器注入数据库路径配置。
     *
     * @param dbPath SQLite 数据库文件路径，来自 {@code repograph.index.db-path}
     */
    public IncrementalIndexCache(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath) {
        this.dbPath = dbPath;
        initDb();
    }

    /** SQLite IN 子句最大参数数，留余量避免触及 999 上限。 */
    private static final int IN_BATCH_SIZE = 500;

    /**
     * 从文件列表中过滤出自上次索引以来已变更的文件。
     *
     * <p>实现策略：
     * <ol>
     *   <li>先在内存中计算全部文件的 MD5（无 DB 访问）</li>
     *   <li>用单个 DB 连接 + IN 子句批量查询已缓存的 MD5（每批 {@value IN_BATCH_SIZE} 条）</li>
     *   <li>在内存中比对，过滤出变更文件</li>
     * </ol>
     *
     * <p>MD5 计算失败的文件视为已变更（重新索引），不中断整体流程。
     *
     * @param files       全量扫描得到的文件路径列表，不为 {@code null}
     * @param projectId   项目唯一标识符，不为 {@code null}
     * @param projectRoot 项目根目录，用于计算相对路径，不为 {@code null}
     * @return 需要重新索引的文件路径列表，文件顺序保留，不为 {@code null}
     */
    public List<Path> filterChanged(List<Path> files, String projectId, Path projectRoot) {
        if (files.isEmpty()) return List.of();

        // 第一步：在内存中计算所有 MD5，不访问数据库
        Map<Path, String> currentMd5s = new LinkedHashMap<>();
        for (Path file : files) {
            currentMd5s.put(file, computeMd5(file)); // 计算出错时返回 null，视为已变更
        }

        // 第二步：通过单次连接批量加载数据库中的缓存 MD5
        List<String> relPaths = files.stream()
                .map(f -> toRelPath(f, projectRoot))
                .collect(Collectors.toList());
        Map<String, String> cachedMd5s = loadCachedMd5s(relPaths, projectId);

        // 第三步：在内存中比对
        return files.stream()
                .filter(file -> {
                    String current = currentMd5s.get(file);
                    if (current == null) return true;
                    return !current.equals(cachedMd5s.get(toRelPath(file, projectRoot)));
                })
                .collect(Collectors.toList());
    }

    /**
     * 在解析前捕获文件指纹，供索引完成时确认提交的是同一份源码。
     *
     * @param files 本轮待解析的文件
     * @return 文件到 MD5 的不可变快照；读取失败的文件不包含在结果中
     */
    public Map<Path, String> captureFingerprints(List<Path> files) {
        Map<Path, String> fingerprints = new LinkedHashMap<>();
        for (Path file : files) {
            String md5 = computeMd5(file);
            if (md5 != null) fingerprints.put(file, md5);
        }
        return Map.copyOf(fingerprints);
    }

    /**
     * 在写入索引前持久化文件的未完成标记，保留失败或中断后的重试资格。
     *
     * @param filePaths 文件相对路径
     * @param projectId 项目标识
     */
    public void markDirty(List<String> filePaths, String projectId) {
        Map<String, String> dirty = new LinkedHashMap<>();
        filePaths.forEach(path -> dirty.put(path, ""));
        writeHashes(dirty, projectId);
    }

    /**
     * 持久化待完成的项目删除，包含没有图节点或文件缓存的项目。
     *
     * @param projectId 项目标识
     */
    public void markProjectDeletionPending(String projectId) {
        updateProjectDeletion("INSERT OR IGNORE INTO pending_project_deletions(project_id) VALUES (?)", projectId);
    }

    /**
     * 查询项目是否存在未完成删除。
     *
     * @param projectId 项目标识
     * @return 是否需要先重试删除
     */
    public boolean hasPendingProjectDeletion(String projectId) {
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT 1 FROM pending_project_deletions WHERE project_id = ?")) {
            ps.setString(1, projectId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to read pending project deletion: " + projectId, e);
        }
    }

    /**
     * 所有存储清理成功后移除项目删除标记。
     *
     * @param projectId 项目标识
     */
    public void completeProjectDeletion(String projectId) {
        updateProjectDeletion("DELETE FROM pending_project_deletions WHERE project_id = ?", projectId);
    }

    private void updateProjectDeletion(String sql, String projectId) {
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, projectId);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to persist project deletion state: " + projectId, e);
        }
    }

    /**
     * 只提交索引期间内容未变化的文件指纹。
     * 变化或无法读取的文件失效并等待下次重试。
     *
     * <p>写入的是解析前指纹。即使文件在最终检查后再次改变，
     * 下次增量扫描仍能检测到变化。
     *
     * @param files 已成功完成解析及存储的文件
     * @param fingerprints 解析前捕获的文件指纹
     * @param projectId 项目唯一标识符
     * @param projectRoot 项目根目录
     * @return 索引期间变化或无法确认内容一致的文件
     */
    public List<Path> updateUnchangedEntries(List<Path> files, Map<Path, String> fingerprints,
                                           String projectId, Path projectRoot) {
        Map<Path, String> unchanged = new LinkedHashMap<>();
        List<Path> changed = new ArrayList<>();
        for (Path file : files) {
            String expected = fingerprints.get(file);
            if (expected != null && expected.equals(computeMd5(file))) {
                unchanged.put(file, expected);
            } else {
                changed.add(file);
            }
        }
        markDirty(changed.stream().map(file -> toRelPath(file, projectRoot)).toList(), projectId);
        writeEntries(unchanged, projectId, projectRoot);
        return List.copyOf(changed);
    }

    /**
     * 查找缓存中存在、但本次扫描已不存在的文件路径。
     *
     * @param currentFiles 当前全量扫描得到的文件
     * @param projectId    项目唯一标识符
     * @param projectRoot  项目根目录
     * @return 已删除或迁移的相对文件路径
     */
    public List<String> findDeletedPaths(List<Path> currentFiles, String projectId, Path projectRoot) {
        Set<String> currentPaths = currentFiles.stream()
                .map(file -> toRelPath(file, projectRoot))
                .collect(Collectors.toCollection(HashSet::new));
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT file_path FROM file_cache WHERE project_id = ? ORDER BY file_path")) {
            ps.setString(1, projectId);
            try (ResultSet rs = ps.executeQuery()) {
                List<String> deleted = new java.util.ArrayList<>();
                while (rs.next()) {
                    String path = rs.getString("file_path");
                    if (!currentPaths.contains(path)) deleted.add(path);
                }
                return List.copyOf(deleted);
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to find deleted files for project: " + projectId, e);
        }
    }

    /**
     * 从 DB 中批量查询指定文件的缓存 MD5，返回 {@code relPath → md5} 映射。
     *
     * <p>使用单连接 + IN 子句，按 {@value IN_BATCH_SIZE} 分批查询以满足 SQLite 参数上限。
     * 查询失败时返回空 Map，调用方将所有文件视为已变更（安全降级）。
     *
     * @param relPaths  文件相对路径列表，不为 {@code null}
     * @param projectId 项目唯一标识符，不为 {@code null}
     * @return relPath → 缓存 MD5 的映射，未命中的文件不在 Map 中
     */
    private Map<String, String> loadCachedMd5s(List<String> relPaths, String projectId) {
        Map<String, String> result = new HashMap<>();
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbPath)) {
            for (int i = 0; i < relPaths.size(); i += IN_BATCH_SIZE) {
                List<String> chunk = relPaths.subList(i, Math.min(i + IN_BATCH_SIZE, relPaths.size()));
                String placeholders = chunk.stream().map(p -> "?").collect(Collectors.joining(","));
                String sql = "SELECT file_path, md5 FROM file_cache WHERE project_id=? AND file_path IN (" + placeholders + ")";
                try (PreparedStatement ps = conn.prepareStatement(sql)) {
                    ps.setString(1, projectId);
                    for (int j = 0; j < chunk.size(); j++) {
                        ps.setString(j + 2, chunk.get(j));
                    }
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) {
                            result.put(rs.getString("file_path"), rs.getString("md5"));
                        }
                    }
                }
            }
        } catch (SQLException e) {
            log.warn("Batch cache lookup failed, treating all files as changed: {}", e.getMessage());
        }
        return result;
    }

    /**
     * 批量更新文件 MD5 缓存，在一个事务内完成，提升写入性能。
     *
     * @param files       已成功索引的文件列表，不为 {@code null}
     * @param projectId   项目唯一标识符，不为 {@code null}
     * @param projectRoot 项目根目录，不为 {@code null}
     */
    public void updateEntries(List<Path> files, String projectId, Path projectRoot) {
        writeEntries(captureFingerprints(files), projectId, projectRoot);
    }

    private void writeEntries(Map<Path, String> fingerprints, String projectId, Path projectRoot) {
        Map<String, String> hashes = new LinkedHashMap<>();
        fingerprints.forEach((path, hash) -> hashes.put(toRelPath(path, projectRoot), hash));
        writeHashes(hashes, projectId);
    }

    private void writeHashes(Map<String, String> hashes, String projectId) {
        if (hashes.isEmpty()) return;
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO file_cache(project_id, file_path, md5) VALUES(?,?,?) " +
                    "ON CONFLICT(project_id, file_path) DO UPDATE SET md5=excluded.md5")) {
                for (Map.Entry<String, String> entry : hashes.entrySet()) {
                    ps.setString(1, projectId);
                    ps.setString(2, entry.getKey());
                    ps.setString(3, entry.getValue());
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            conn.commit();
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to persist index cache state: " + projectId, e);
        }
    }

    /**
     * 删除单条文件缓存记录，在文件被物理删除时调用，避免下次全量扫描时留下孤立条目。
     *
     * @param relPath   文件相对路径（使用 {@code /} 分隔），不为 {@code null}
     * @param projectId 项目唯一标识符，不为 {@code null}
     */
    public void removeEntry(String relPath, String projectId) {
        if (relPath == null || projectId == null) return;
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(
                     "DELETE FROM file_cache WHERE project_id = ? AND file_path = ?")) {
            ps.setString(1, projectId);
            ps.setString(2, relPath);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to remove cache entry: " + projectId + "/" + relPath, e);
        }
    }

    /**
     * 删除指定项目在缓存中的所有 MD5 条目，用于项目级清理。
     *
     * <p>下次对该项目执行索引时会重新扫描全部文件并写入 MD5，相当于强制全量重索引。
     *
     * @param projectId 项目唯一标识符，不为 {@code null}
     */
    public void removeProject(String projectId) {
        if (projectId == null || projectId.isBlank()) return;
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(
                     "DELETE FROM file_cache WHERE project_id = ?")) {
            ps.setString(1, projectId);
            int deleted = ps.executeUpdate();
            log.info("Removed {} cache entry/entries for project '{}'", deleted, projectId);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to clear cache for project: " + projectId, e);
        }
    }

    // ── 内部方法 ─────────────────────────────────────────────────────────────

    private void initDb() {
        try {
            Path dbFile = Path.of(dbPath);
            if (dbFile.getParent() != null) {
                Files.createDirectories(dbFile.getParent());
            }
            String url = "jdbc:sqlite:" + dbPath;
            try (Connection conn = DriverManager.getConnection(url);
                 Statement stmt = conn.createStatement()) {
                stmt.execute("""
                    CREATE TABLE IF NOT EXISTS file_cache (
                        project_id TEXT NOT NULL,
                        file_path  TEXT NOT NULL,
                        md5        TEXT NOT NULL,
                        PRIMARY KEY (project_id, file_path)
                    )
                    """);
                stmt.execute("""
                    CREATE TABLE IF NOT EXISTS pending_project_deletions (
                        project_id TEXT PRIMARY KEY NOT NULL
                    )
                    """);
            }
            log.debug("Incremental index cache initialised at '{}'", dbPath);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to initialise incremental cache: " + dbPath, e);
        }
    }

    private String toRelPath(Path file, Path projectRoot) {
        try {
            return projectRoot.toAbsolutePath().normalize()
                .relativize(file.toAbsolutePath().normalize())
                .toString()
                .replace('\\', '/');
        } catch (IllegalArgumentException e) {
            return file.toString().replace('\\', '/');
        }
    }

    private String computeMd5(Path file) {
        try {
            byte[] bytes = Files.readAllBytes(file);
            MessageDigest md = MessageDigest.getInstance("MD5");
            return HexFormat.of().formatHex(md.digest(bytes));
        } catch (Exception e) {
            log.warn("Failed to compute MD5 for '{}': {}", file, e.getMessage());
            return null;
        }
    }
}
