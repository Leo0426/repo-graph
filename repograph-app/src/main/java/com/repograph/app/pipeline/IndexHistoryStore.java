package com.repograph.app.pipeline;

import com.repograph.core.pipeline.IndexResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * 基于 SQLite 的索引历史持久化，将每次索引的结果写入 {@code index_history} 表。
 *
 * <p>与 {@link IncrementalIndexCache} 共用同一个 SQLite 文件（{@code ~/.repograph/index.db}），
 * 每个 projectRoot 仅保留最新一条记录（UPSERT on conflict）。
 *
 * <p>服务重启后，{@code GET /api/v1/index/project/status} 可通过此表恢复最近一次的索引结果，
 * 无需重新触发索引。
 *
 * @author leolu
 * @since 0.5.0
 */
@Service
public class IndexHistoryStore {

    private static final Logger log = LoggerFactory.getLogger(IndexHistoryStore.class);

    private final String dbPath;

    public IndexHistoryStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath) {
        this.dbPath = dbPath;
        initTable();
    }

    /**
     * 保存或覆盖指定 projectRoot 的最新索引历史。
     *
     * @param projectRoot 项目根目录绝对路径
     * @param status      "done"、"partial" 或 "error: ..."
     * @param result      索引结果统计，status 为 error 时可为 {@code null}
     */
    public void save(String projectRoot, String status, IndexResult result) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("""
                     INSERT INTO index_history
                         (project_root, status, total_files, parsed_files, skipped_files,
                          degraded_files, total_units, total_edges, duration_ms, errors, indexed_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)
                     ON CONFLICT(project_root) DO UPDATE SET
                         status        = excluded.status,
                         total_files   = excluded.total_files,
                         parsed_files  = excluded.parsed_files,
                         skipped_files = excluded.skipped_files,
                         degraded_files= excluded.degraded_files,
                         total_units   = excluded.total_units,
                         total_edges   = excluded.total_edges,
                         duration_ms   = excluded.duration_ms,
                         errors        = excluded.errors,
                         indexed_at    = excluded.indexed_at
                     """)) {
            ps.setString(1, projectRoot);
            ps.setString(2, status);
            if (result != null) {
                ps.setInt(3, result.totalFiles());
                ps.setInt(4, result.parsedFiles());
                ps.setInt(5, result.skippedFiles());
                ps.setInt(6, result.degradedFiles());
                ps.setInt(7, result.totalUnits());
                ps.setInt(8, result.totalEdges());
                ps.setLong(9, result.durationMs());
                ps.setString(10, String.join("\n", result.errors()));
            } else {
                for (int i = 3; i <= 9; i++) ps.setNull(i, java.sql.Types.INTEGER);
                ps.setNull(10, java.sql.Types.VARCHAR);
            }
            ps.setString(11, Instant.now().toString());
            ps.executeUpdate();
        } catch (SQLException e) {
            log.warn("Failed to save index history for '{}': {}", projectRoot, e.getMessage());
        }
    }

    /**
     * 加载指定 projectRoot 的最近一次索引历史。
     *
     * @param projectRoot 项目根目录绝对路径
     * @return 历史记录，若不存在则为空
     */
    public Optional<IndexHistory> load(String projectRoot) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT * FROM index_history WHERE project_root = ?")) {
            ps.setString(1, projectRoot);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                IndexResult result = null;
                if (!"error".equals(rs.getString("status")) || rs.getInt("total_files") > 0) {
                    List<String> errors = rs.getString("errors") == null || rs.getString("errors").isBlank()
                            ? List.of()
                            : List.of(rs.getString("errors").split("\n"));
                    result = new IndexResult(
                            rs.getInt("total_files"), rs.getInt("parsed_files"),
                            rs.getInt("skipped_files"), rs.getInt("degraded_files"),
                            rs.getInt("total_units"), rs.getInt("total_edges"),
                            rs.getLong("duration_ms"), errors);
                }
                return Optional.of(new IndexHistory(
                        rs.getString("project_root"),
                        rs.getString("status"),
                        rs.getString("indexed_at"),
                        result));
            }
        } catch (SQLException e) {
            log.warn("Failed to load index history for '{}': {}", projectRoot, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * 删除指定项目的历史记录，配合项目删除操作使用。
     */
    public void remove(String projectRoot) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(
                     "DELETE FROM index_history WHERE project_root = ?")) {
            ps.setString(1, projectRoot);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.warn("Failed to remove index history for '{}': {}", projectRoot, e.getMessage());
        }
    }

    // ── 内部方法 ──────────────────────────────────────────────────────────────

    private void initTable() {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement()) {
            stmt.execute("""
                    CREATE TABLE IF NOT EXISTS index_history (
                        project_root   TEXT PRIMARY KEY,
                        status         TEXT NOT NULL,
                        total_files    INTEGER,
                        parsed_files   INTEGER,
                        skipped_files  INTEGER,
                        degraded_files INTEGER,
                        total_units    INTEGER,
                        total_edges    INTEGER,
                        duration_ms    INTEGER,
                        errors         TEXT,
                        indexed_at     TEXT NOT NULL
                    )
                    """);
        } catch (SQLException e) {
            log.warn("Failed to init index_history table: {}", e.getMessage());
        }
    }

    /**
     * 单条索引历史记录。
     *
     * @param projectRoot 项目根目录
     * @param status      "done"、"partial" 或 "error: ..."
     * @param indexedAt   ISO-8601 时间戳
     * @param result      索引统计，error 时可能为 {@code null}
     */
    public record IndexHistory(
            String projectRoot,
            String status,
            String indexedAt,
            IndexResult result) {}
}
