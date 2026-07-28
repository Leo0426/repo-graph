package com.repograph.finding;

import com.repograph.core.finding.RuleSuppression;
import com.repograph.core.finding.RuleSuppressionAuditEvent;
import com.repograph.core.finding.RuleSuppressionScope;
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
import java.util.regex.Pattern;

/**
 * 规则抑制和不可变审计事件的 SQLite 存储。
 *
 * @author leolu
 */
@Service
public class RuleSuppressionStore {

    private final String dbPath;

    /**
     * 创建规则抑制存储。
     *
     * @param dbPath SQLite 数据库路径
     */
    public RuleSuppressionStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath) {
        this.dbPath = dbPath;
        initTables();
    }

    /**
     * 创建策略并同时写入 CREATED 审计事件。
     *
     * @param suppression 新策略
     */
    public void create(RuleSuppression suppression) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (PreparedStatement insert = conn.prepareStatement("""
                    INSERT INTO rule_suppressions
                        (id, project_id, rule_id, scope, scope_value, reason,
                         created_by, created_at, expires_at, active)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                    """)) {
                bindSuppression(insert, suppression);
                insert.executeUpdate();
            }
            insertAudit(conn, new RuleSuppressionAuditEvent(
                    UUID.randomUUID().toString(),
                    suppression.id(),
                    "CREATED",
                    suppression.createdBy(),
                    suppression.reason(),
                    suppression.createdAt()));
            conn.commit();
        } catch (SQLException e) {
            throw new IllegalStateException(
                    "Failed to create rule suppression '" + suppression.id() + "'", e);
        }
    }

    /**
     * 查找当前时刻覆盖指定报警的活动策略。
     *
     * @param projectId 项目标识
     * @param ruleId    规则标识
     * @param filePath  报警项目相对路径
     * @param now       判定有效期的当前时间
     * @return 最近创建的匹配策略
     */
    public Optional<RuleSuppression> findActive(
            String projectId,
            String ruleId,
            String filePath,
            Instant now) {
        String url = "jdbc:sqlite:" + dbPath;
        List<RuleSuppression> candidates = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement("""
                     SELECT * FROM rule_suppressions
                     WHERE project_id = ? AND rule_id = ? AND active = 1
                     ORDER BY created_at DESC
                     """)) {
            statement.setString(1, projectId);
            statement.setString(2, ruleId);
            try (ResultSet rs = statement.executeQuery()) {
                while (rs.next()) {
                    candidates.add(fromRow(rs));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to query active rule suppressions", e);
        }
        return candidates.stream()
                .filter(candidate -> Instant.parse(candidate.expiresAt()).isAfter(now))
                .filter(candidate -> matchesScope(candidate, filePath))
                .findFirst();
    }

    /**
     * 查询项目规则抑制策略。
     *
     * @param projectId 项目标识
     * @param ruleId    可选规则标识
     * @return 按创建时间倒序的策略
     */
    public List<RuleSuppression> list(String projectId, String ruleId) {
        boolean filterRule = ruleId != null && !ruleId.isBlank();
        String sql = filterRule
                ? "SELECT * FROM rule_suppressions WHERE project_id = ? AND rule_id = ? "
                        + "ORDER BY created_at DESC"
                : "SELECT * FROM rule_suppressions WHERE project_id = ? ORDER BY created_at DESC";
        String url = "jdbc:sqlite:" + dbPath;
        List<RuleSuppression> result = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement(sql)) {
            statement.setString(1, projectId);
            if (filterRule) {
                statement.setString(2, ruleId);
            }
            try (ResultSet rs = statement.executeQuery()) {
                while (rs.next()) {
                    result.add(fromRow(rs));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to list rule suppressions", e);
        }
        return List.copyOf(result);
    }

    /**
     * 撤销活动策略并追加 REVOKED 审计事件。
     *
     * @param suppressionId 策略标识
     * @param actor         操作人
     * @param reason        撤销理由
     * @param occurredAt    操作时间
     * @return 策略是否存在且由活动状态变为撤销
     */
    public boolean revoke(
            String suppressionId,
            String actor,
            String reason,
            String occurredAt) {
        if (actor == null || actor.isBlank() || reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("actor and reason are required");
        }
        Instant.parse(occurredAt);
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            int updated;
            try (PreparedStatement statement = conn.prepareStatement(
                    "UPDATE rule_suppressions SET active = 0 WHERE id = ? AND active = 1")) {
                statement.setString(1, suppressionId);
                updated = statement.executeUpdate();
            }
            if (updated > 0) {
                insertAudit(conn, new RuleSuppressionAuditEvent(
                        UUID.randomUUID().toString(),
                        suppressionId,
                        "REVOKED",
                        actor.trim(),
                        reason.trim(),
                        occurredAt));
            }
            conn.commit();
            return updated > 0;
        } catch (SQLException e) {
            throw new IllegalStateException(
                    "Failed to revoke rule suppression '" + suppressionId + "'", e);
        }
    }

    /**
     * 查询策略的不可变审计事件。
     *
     * @param suppressionId 策略标识
     * @return 按时间升序的事件
     */
    public List<RuleSuppressionAuditEvent> audit(String suppressionId) {
        String url = "jdbc:sqlite:" + dbPath;
        List<RuleSuppressionAuditEvent> result = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement("""
                     SELECT * FROM rule_suppression_audit
                     WHERE suppression_id = ?
                     ORDER BY occurred_at, id
                     """)) {
            statement.setString(1, suppressionId);
            try (ResultSet rs = statement.executeQuery()) {
                while (rs.next()) {
                    result.add(new RuleSuppressionAuditEvent(
                            rs.getString("id"),
                            rs.getString("suppression_id"),
                            rs.getString("action"),
                            rs.getString("actor"),
                            rs.getString("reason"),
                            rs.getString("occurred_at")));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to query rule suppression audit", e);
        }
        return List.copyOf(result);
    }

    /**
     * 删除项目策略及其审计事件。
     *
     * @param projectId 项目标识
     */
    public void removeProject(String projectId) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (PreparedStatement audit = conn.prepareStatement("""
                    DELETE FROM rule_suppression_audit
                    WHERE suppression_id IN (
                        SELECT id FROM rule_suppressions WHERE project_id = ?
                    )
                    """);
                 PreparedStatement suppressions = conn.prepareStatement(
                         "DELETE FROM rule_suppressions WHERE project_id = ?")) {
                audit.setString(1, projectId);
                audit.executeUpdate();
                suppressions.setString(1, projectId);
                suppressions.executeUpdate();
            }
            conn.commit();
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to remove project rule suppressions", e);
        }
    }

    private void initTables() {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             Statement statement = conn.createStatement()) {
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS rule_suppressions (
                        id          TEXT PRIMARY KEY,
                        project_id  TEXT NOT NULL,
                        rule_id     TEXT NOT NULL,
                        scope       TEXT NOT NULL,
                        scope_value TEXT NOT NULL DEFAULT '',
                        reason      TEXT NOT NULL,
                        created_by  TEXT NOT NULL,
                        created_at  TEXT NOT NULL,
                        expires_at  TEXT NOT NULL,
                        active      INTEGER NOT NULL DEFAULT 1
                    )
                    """);
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS rule_suppression_audit (
                        id             TEXT PRIMARY KEY,
                        suppression_id TEXT NOT NULL,
                        action         TEXT NOT NULL,
                        actor          TEXT NOT NULL,
                        reason         TEXT NOT NULL,
                        occurred_at    TEXT NOT NULL
                    )
                    """);
            statement.execute("""
                    CREATE INDEX IF NOT EXISTS idx_rule_suppressions_lookup
                    ON rule_suppressions(project_id, rule_id, active)
                    """);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to initialize rule suppression tables", e);
        }
    }

    private static void bindSuppression(
            PreparedStatement statement,
            RuleSuppression suppression) throws SQLException {
        statement.setString(1, suppression.id());
        statement.setString(2, suppression.projectId());
        statement.setString(3, suppression.ruleId());
        statement.setString(4, suppression.scope().name());
        statement.setString(5, suppression.scopeValue());
        statement.setString(6, suppression.reason());
        statement.setString(7, suppression.createdBy());
        statement.setString(8, suppression.createdAt());
        statement.setString(9, suppression.expiresAt());
        statement.setInt(10, suppression.active() ? 1 : 0);
    }

    private static void insertAudit(
            Connection conn,
            RuleSuppressionAuditEvent event) throws SQLException {
        try (PreparedStatement statement = conn.prepareStatement("""
                INSERT INTO rule_suppression_audit
                    (id, suppression_id, action, actor, reason, occurred_at)
                VALUES (?,?,?,?,?,?)
                """)) {
            statement.setString(1, event.id());
            statement.setString(2, event.suppressionId());
            statement.setString(3, event.action());
            statement.setString(4, event.actor());
            statement.setString(5, event.reason());
            statement.setString(6, event.occurredAt());
            statement.executeUpdate();
        }
    }

    private static RuleSuppression fromRow(ResultSet rs) throws SQLException {
        return new RuleSuppression(
                rs.getString("id"),
                rs.getString("project_id"),
                rs.getString("rule_id"),
                RuleSuppressionScope.valueOf(rs.getString("scope")),
                rs.getString("scope_value"),
                rs.getString("reason"),
                rs.getString("created_by"),
                rs.getString("created_at"),
                rs.getString("expires_at"),
                rs.getInt("active") == 1);
    }

    private static boolean matchesScope(RuleSuppression suppression, String filePath) {
        if (suppression.scope() == RuleSuppressionScope.PROJECT) {
            return true;
        }
        return Pattern.matches(globRegex(suppression.scopeValue()), filePath.replace('\\', '/'));
    }

    private static String globRegex(String glob) {
        StringBuilder regex = new StringBuilder("^");
        for (int index = 0; index < glob.length(); index++) {
            char current = glob.charAt(index);
            if (current == '*') {
                boolean doubleStar = index + 1 < glob.length() && glob.charAt(index + 1) == '*';
                regex.append(doubleStar ? ".*" : "[^/]*");
                if (doubleStar) {
                    index++;
                }
            } else if (current == '?') {
                regex.append("[^/]");
            } else {
                if ("\\.[]{}()+-^$|".indexOf(current) >= 0) {
                    regex.append('\\');
                }
                regex.append(current);
            }
        }
        return regex.append('$').toString();
    }
}
