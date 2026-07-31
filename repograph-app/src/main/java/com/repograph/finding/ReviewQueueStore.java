package com.repograph.finding;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ReportSnapshot;
import com.repograph.core.finding.ReviewQueueAuditEvent;
import com.repograph.core.finding.ReviewQueueEntry;
import com.repograph.core.finding.ReviewQueueService;
import com.repograph.core.finding.ReviewStatus;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 审核队列条目、报告快照及不可变审计事件的 SQLite 存储。
 *
 * @author leolu
 */
@Service
public class ReviewQueueStore implements ReviewQueueService {

    private final String dbPath;
    private final ObjectMapper objectMapper;

    /**
     * 创建审核队列存储。
     *
     * @param dbPath       SQLite 数据库路径
     * @param objectMapper 报告快照序列化使用的 Jackson mapper
     */
    public ReviewQueueStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath,
            ObjectMapper objectMapper) {
        this.dbPath = dbPath;
        this.objectMapper = objectMapper;
        initTables();
    }

    @Override
    public List<ReviewQueueEntry> submit(ReportSnapshot snapshot) {
        String url = "jdbc:sqlite:" + dbPath;
        List<ReviewQueueEntry> entries = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            String reportsJson;
            try {
                reportsJson = objectMapper.writeValueAsString(snapshot.reports());
            } catch (Exception e) {
                throw new IllegalStateException(
                        "Failed to serialize report snapshot '" + snapshot.id() + "'", e);
            }
            try (PreparedStatement insert = conn.prepareStatement("""
                    INSERT INTO report_snapshots
                        (id, project_id, schema_version, tool_version, code_version,
                         rule_version, generated_at, reports_json)
                    VALUES (?,?,?,?,?,?,?,?)
                    """)) {
                insert.setString(1, snapshot.id());
                insert.setString(2, snapshot.projectId());
                insert.setString(3, snapshot.schemaVersion());
                insert.setString(4, snapshot.toolVersion());
                insert.setString(5, snapshot.codeVersion());
                insert.setString(6, snapshot.ruleVersion());
                insert.setString(7, snapshot.generatedAt());
                insert.setString(8, reportsJson);
                insert.executeUpdate();
            }
            for (TriageReport report : snapshot.reports()) {
                ExternalFinding finding = report.finding();
                ReviewQueueEntry entry = new ReviewQueueEntry(
                        UUID.randomUUID().toString(),
                        snapshot.id(),
                        snapshot.projectId(),
                        finding.fingerprint(),
                        finding.ruleId(),
                        finding.cwe(),
                        finding.severity(),
                        report.verdict(),
                        report.confidence(),
                        ReviewStatus.PENDING,
                        "",
                        "",
                        snapshot.generatedAt());
                insertEntry(conn, entry);
                insertAudit(conn, new ReviewQueueAuditEvent(
                        UUID.randomUUID().toString(),
                        entry.id(),
                        "SUBMITTED",
                        "system",
                        "",
                        snapshot.generatedAt()));
                entries.add(entry);
            }
            conn.commit();
        } catch (SQLException e) {
            throw new IllegalStateException(
                    "Failed to submit report snapshot '" + snapshot.id() + "'", e);
        }
        return List.copyOf(entries);
    }

    @Override
    public List<ReviewQueueEntry> list(
            String projectId,
            ExternalFindingSeverity severity,
            TriageVerdict verdict,
            ReviewStatus status,
            String ruleId,
            String updatedAfter,
            String updatedBefore) {
        StringBuilder sql = new StringBuilder(
                "SELECT * FROM review_queue_entries WHERE project_id = ?");
        List<Object> params = new ArrayList<>();
        params.add(projectId);
        if (severity != null) {
            sql.append(" AND severity = ?");
            params.add(severity.name());
        }
        if (verdict != null) {
            sql.append(" AND verdict = ?");
            params.add(verdict.name());
        }
        if (status != null) {
            sql.append(" AND status = ?");
            params.add(status.name());
        }
        if (ruleId != null && !ruleId.isBlank()) {
            sql.append(" AND rule_id = ?");
            params.add(ruleId);
        }
        if (updatedAfter != null && !updatedAfter.isBlank()) {
            sql.append(" AND updated_at >= ?");
            params.add(updatedAfter);
        }
        if (updatedBefore != null && !updatedBefore.isBlank()) {
            sql.append(" AND updated_at < ?");
            params.add(updatedBefore);
        }
        sql.append(" ORDER BY updated_at DESC");

        String url = "jdbc:sqlite:" + dbPath;
        List<ReviewQueueEntry> result = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement(sql.toString())) {
            for (int i = 0; i < params.size(); i++) {
                statement.setString(i + 1, (String) params.get(i));
            }
            try (ResultSet rs = statement.executeQuery()) {
                while (rs.next()) {
                    result.add(fromRow(rs));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to list review queue entries", e);
        }
        return List.copyOf(result);
    }

    @Override
    public boolean claim(String entryId, String actor, String occurredAt) {
        requireActorAndTime(actor, occurredAt);
        // 仅允许从 PENDING 认领，避免在他人复核中途被静默改派。
        return transition(entryId, "PENDING", ReviewStatus.IN_REVIEW, actor.trim(),
                occurredAt, "CLAIMED", "", actor.trim(), occurredAt);
    }

    @Override
    public boolean returnToQueue(String entryId, String actor, String reason, String occurredAt) {
        requireActorReasonAndTime(actor, reason, occurredAt);
        return transition(entryId, "IN_REVIEW", ReviewStatus.PENDING, actor.trim(),
                occurredAt, "RETURNED", reason.trim(), "", "");
    }

    @Override
    public boolean confirm(String entryId, String actor, String reason, String occurredAt) {
        requireActorReasonAndTime(actor, reason, occurredAt);
        return transition(entryId, "IN_REVIEW", ReviewStatus.CONFIRMED, actor.trim(),
                occurredAt, "CONFIRMED", reason.trim(), null, null);
    }

    @Override
    public boolean reject(String entryId, String actor, String reason, String occurredAt) {
        requireActorReasonAndTime(actor, reason, occurredAt);
        return transition(entryId, "IN_REVIEW", ReviewStatus.REJECTED, actor.trim(),
                occurredAt, "REJECTED", reason.trim(), null, null);
    }

    @Override
    public List<ReviewQueueAuditEvent> audit(String entryId) {
        String url = "jdbc:sqlite:" + dbPath;
        List<ReviewQueueAuditEvent> result = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement("""
                     SELECT * FROM review_queue_audit
                     WHERE entry_id = ?
                     ORDER BY occurred_at, id
                     """)) {
            statement.setString(1, entryId);
            try (ResultSet rs = statement.executeQuery()) {
                while (rs.next()) {
                    result.add(new ReviewQueueAuditEvent(
                            rs.getString("id"),
                            rs.getString("entry_id"),
                            rs.getString("action"),
                            rs.getString("actor"),
                            rs.getString("reason"),
                            rs.getString("occurred_at")));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to query review queue audit", e);
        }
        return List.copyOf(result);
    }

    @Override
    public Optional<ReportSnapshot> getSnapshot(String snapshotId) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement(
                     "SELECT * FROM report_snapshots WHERE id = ?")) {
            statement.setString(1, snapshotId);
            try (ResultSet rs = statement.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                List<TriageReport> reports;
                try {
                    reports = objectMapper.readValue(
                            rs.getString("reports_json"), new TypeReference<List<TriageReport>>() {});
                } catch (Exception e) {
                    throw new IllegalStateException(
                            "Failed to deserialize report snapshot '" + snapshotId + "'", e);
                }
                return Optional.of(new ReportSnapshot(
                        rs.getString("id"),
                        rs.getString("project_id"),
                        rs.getString("schema_version"),
                        rs.getString("tool_version"),
                        rs.getString("code_version"),
                        rs.getString("rule_version"),
                        rs.getString("generated_at"),
                        reports));
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to query report snapshot '" + snapshotId + "'", e);
        }
    }

    /**
     * 在单事务内做条件状态迁移：仅当条目当前状态等于 {@code fromStatus} 才生效，
     * 生效时同时更新 {@code claimed_by} 并追加一条审计事件。
     *
     * @param claimedByOverride 迁移后应写入的 {@code claimed_by}；{@code null} 表示保持原值不变
     * @param claimedAtOverride 迁移后应写入的 {@code claimed_at}；{@code null} 表示保持原值不变
     */
    private boolean transition(
            String entryId,
            String fromStatus,
            ReviewStatus toStatus,
            String actor,
            String occurredAt,
            String action,
            String reason,
            String claimedByOverride,
            String claimedAtOverride) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            int updated;
            String sql = claimedByOverride == null
                    ? "UPDATE review_queue_entries SET status = ?, updated_at = ? "
                            + "WHERE id = ? AND status = ?"
                    : "UPDATE review_queue_entries SET status = ?, updated_at = ?, "
                            + "claimed_by = ?, claimed_at = ? WHERE id = ? AND status = ?";
            try (PreparedStatement statement = conn.prepareStatement(sql)) {
                statement.setString(1, toStatus.name());
                statement.setString(2, occurredAt);
                if (claimedByOverride == null) {
                    statement.setString(3, entryId);
                    statement.setString(4, fromStatus);
                } else {
                    statement.setString(3, claimedByOverride);
                    statement.setString(4, claimedAtOverride);
                    statement.setString(5, entryId);
                    statement.setString(6, fromStatus);
                }
                updated = statement.executeUpdate();
            }
            if (updated > 0) {
                insertAudit(conn, new ReviewQueueAuditEvent(
                        UUID.randomUUID().toString(), entryId, action, actor, reason, occurredAt));
            }
            conn.commit();
            return updated > 0;
        } catch (SQLException e) {
            throw new IllegalStateException(
                    "Failed to transition review queue entry '" + entryId + "' to " + toStatus, e);
        }
    }

    private static void requireActorAndTime(String actor, String occurredAt) {
        if (actor == null || actor.isBlank()) {
            throw new IllegalArgumentException("actor is required");
        }
        Instant.parse(occurredAt);
    }

    private static void requireActorReasonAndTime(String actor, String reason, String occurredAt) {
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("reason is required");
        }
        requireActorAndTime(actor, occurredAt);
    }

    private void initTables() {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             Statement statement = conn.createStatement()) {
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS report_snapshots (
                        id             TEXT PRIMARY KEY,
                        project_id     TEXT NOT NULL,
                        schema_version TEXT NOT NULL,
                        tool_version   TEXT NOT NULL,
                        code_version   TEXT NOT NULL,
                        rule_version   TEXT NOT NULL,
                        generated_at   TEXT NOT NULL,
                        reports_json   TEXT NOT NULL
                    )
                    """);
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS review_queue_entries (
                        id          TEXT PRIMARY KEY,
                        snapshot_id TEXT NOT NULL,
                        project_id  TEXT NOT NULL,
                        fingerprint TEXT NOT NULL,
                        rule_id     TEXT NOT NULL,
                        cwe         TEXT NOT NULL DEFAULT '',
                        severity    TEXT NOT NULL,
                        verdict     TEXT NOT NULL,
                        confidence  REAL NOT NULL,
                        status      TEXT NOT NULL,
                        claimed_by  TEXT NOT NULL DEFAULT '',
                        claimed_at  TEXT NOT NULL DEFAULT '',
                        updated_at  TEXT NOT NULL
                    )
                    """);
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS review_queue_audit (
                        id          TEXT PRIMARY KEY,
                        entry_id    TEXT NOT NULL,
                        action      TEXT NOT NULL,
                        actor       TEXT NOT NULL,
                        reason      TEXT NOT NULL,
                        occurred_at TEXT NOT NULL
                    )
                    """);
            statement.execute("""
                    CREATE INDEX IF NOT EXISTS idx_review_queue_lookup
                    ON review_queue_entries(project_id, status, rule_id, updated_at)
                    """);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to initialize review queue tables", e);
        }
    }

    private static void insertEntry(Connection conn, ReviewQueueEntry entry) throws SQLException {
        try (PreparedStatement statement = conn.prepareStatement("""
                INSERT INTO review_queue_entries
                    (id, snapshot_id, project_id, fingerprint, rule_id, cwe, severity,
                     verdict, confidence, status, claimed_by, claimed_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """)) {
            statement.setString(1, entry.id());
            statement.setString(2, entry.snapshotId());
            statement.setString(3, entry.projectId());
            statement.setString(4, entry.fingerprint());
            statement.setString(5, entry.ruleId());
            statement.setString(6, entry.cwe());
            statement.setString(7, entry.severity().name());
            statement.setString(8, entry.verdict().name());
            statement.setFloat(9, entry.confidence());
            statement.setString(10, entry.status().name());
            statement.setString(11, entry.claimedBy());
            statement.setString(12, entry.claimedAt());
            statement.setString(13, entry.updatedAt());
            statement.executeUpdate();
        }
    }

    private static void insertAudit(Connection conn, ReviewQueueAuditEvent event) throws SQLException {
        try (PreparedStatement statement = conn.prepareStatement("""
                INSERT INTO review_queue_audit
                    (id, entry_id, action, actor, reason, occurred_at)
                VALUES (?,?,?,?,?,?)
                """)) {
            statement.setString(1, event.id());
            statement.setString(2, event.entryId());
            statement.setString(3, event.action());
            statement.setString(4, event.actor());
            statement.setString(5, event.reason());
            statement.setString(6, event.occurredAt());
            statement.executeUpdate();
        }
    }

    private static ReviewQueueEntry fromRow(ResultSet rs) throws SQLException {
        return new ReviewQueueEntry(
                rs.getString("id"),
                rs.getString("snapshot_id"),
                rs.getString("project_id"),
                rs.getString("fingerprint"),
                rs.getString("rule_id"),
                rs.getString("cwe"),
                ExternalFindingSeverity.valueOf(rs.getString("severity")),
                TriageVerdict.valueOf(rs.getString("verdict")),
                rs.getFloat("confidence"),
                ReviewStatus.valueOf(rs.getString("status")),
                rs.getString("claimed_by"),
                rs.getString("claimed_at"),
                rs.getString("updated_at"));
    }
}
