package com.repograph.finding;

import com.repograph.core.finding.TriageFeedback;
import com.repograph.core.finding.TriageFeedbackStatus;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 研判反馈的 SQLite 持久化，与增量索引缓存共用同一个 {@code index.db} 文件。
 *
 * <p>以外部报警指纹为主键，同一报警重复反馈时覆盖状态、reviewer、理由和更新时间，
 * upsert 幂等。
 *
 * @author leolu
 */
@Service
public class TriageFeedbackStore {

    private static final Logger log = LoggerFactory.getLogger(TriageFeedbackStore.class);

    private final String dbPath;

    /**
     * 创建反馈存储并初始化表结构。
     *
     * @param dbPath SQLite 数据库文件路径
     */
    public TriageFeedbackStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath) {
        this.dbPath = dbPath;
        initTable();
    }

    /**
     * 写入或覆盖一条反馈记录。
     *
     * @param feedback 反馈记录
     * @throws IllegalStateException 数据库写入失败
     */
    public void upsert(TriageFeedback feedback) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("""
                     INSERT INTO triage_feedback
                         (fingerprint, project_id, status, reviewer, reason, updated_at)
                     VALUES (?,?,?,?,?,?)
                     ON CONFLICT(fingerprint) DO UPDATE SET
                         project_id = excluded.project_id,
                         status     = excluded.status,
                         reviewer   = excluded.reviewer,
                         reason     = excluded.reason,
                         updated_at = excluded.updated_at
                     """)) {
            ps.setString(1, feedback.fingerprint());
            ps.setString(2, feedback.projectId());
            ps.setString(3, feedback.status().name());
            ps.setString(4, feedback.reviewer());
            ps.setString(5, feedback.reason());
            ps.setString(6, feedback.updatedAt());
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(
                    "Failed to upsert triage feedback '" + feedback.fingerprint() + "'", e);
        }
    }

    /**
     * 查询指定项目的反馈记录，支持按状态过滤。
     *
     * @param projectId 项目 ID，不为 {@code null}
     * @param status    可选状态过滤；为空时返回所有状态
     * @return 按 updated_at 降序排列的反馈列表
     */
    public List<TriageFeedback> list(String projectId, TriageFeedbackStatus status) {
        StringBuilder sql = new StringBuilder(
                "SELECT * FROM triage_feedback WHERE project_id = ?");
        List<Object> params = new ArrayList<>();
        params.add(projectId);
        if (status != null) {
            sql.append(" AND status = ?");
            params.add(status.name());
        }
        sql.append(" ORDER BY updated_at DESC");

        List<TriageFeedback> result = new ArrayList<>();
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(sql.toString())) {
            for (int i = 0; i < params.size(); i++) ps.setObject(i + 1, params.get(i));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) result.add(fromRow(rs));
            }
        } catch (SQLException e) {
            log.warn("Failed to list triage feedback for '{}': {}", projectId, e.getMessage());
        }
        return result;
    }

    /**
     * 按指纹精确查找一条反馈记录。
     *
     * @param fingerprint 外部报警指纹
     * @return 反馈记录；不存在时为空
     */
    public Optional<TriageFeedback> findByFingerprint(String fingerprint) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT * FROM triage_feedback WHERE fingerprint = ?")) {
            ps.setString(1, fingerprint);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                return Optional.of(fromRow(rs));
            }
        } catch (SQLException e) {
            log.warn("Failed to find triage feedback '{}': {}", fingerprint, e.getMessage());
            return Optional.empty();
        }
    }

    // ── 内部方法 ──────────────────────────────────────────────────────────────

    private void initTable() {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement()) {
            stmt.execute("""
                    CREATE TABLE IF NOT EXISTS triage_feedback (
                        fingerprint TEXT PRIMARY KEY,
                        project_id  TEXT NOT NULL,
                        status      TEXT NOT NULL,
                        reviewer    TEXT NOT NULL DEFAULT '',
                        reason      TEXT NOT NULL DEFAULT '',
                        updated_at  TEXT NOT NULL
                    )
                    """);
            stmt.execute(
                    "CREATE INDEX IF NOT EXISTS idx_triage_feedback_project ON triage_feedback(project_id)");
        } catch (SQLException e) {
            log.warn("Failed to init triage_feedback table: {}", e.getMessage());
        }
    }

    private static TriageFeedback fromRow(ResultSet rs) throws SQLException {
        return new TriageFeedback(
                rs.getString("fingerprint"),
                rs.getString("project_id"),
                TriageFeedbackStatus.parse(rs.getString("status")),
                rs.getString("reviewer"),
                rs.getString("reason"),
                rs.getString("updated_at"));
    }
}
