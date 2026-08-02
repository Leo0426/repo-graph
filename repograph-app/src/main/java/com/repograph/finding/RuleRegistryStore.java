package com.repograph.finding;

import com.repograph.core.finding.DetectionRule;
import com.repograph.core.finding.DetectionRuleDraft;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.RuleAuditEvent;
import com.repograph.core.finding.RuleMatcherKind;
import com.repograph.core.finding.RuleNotFoundException;
import com.repograph.core.finding.RuleRegistry;
import com.repograph.core.finding.RuleStatus;
import com.repograph.core.finding.RuleTransitionException;
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
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * 基于 SQLite 的检测规则注册表，实现版本、生命周期、回归发布闸门和审计。
 *
 * @author leolu
 */
@Service
public class RuleRegistryStore implements RuleRegistry {

    private final String dbPath;

    /**
     * 创建规则注册表。
     *
     * @param dbPath SQLite 数据库路径
     */
    public RuleRegistryStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath) {
        this.dbPath = dbPath;
        initTables();
    }

    /** {@inheritDoc} */
    @Override
    public DetectionRule createCandidate(
            DetectionRuleDraft draft, String actor, String reason, String occurredAt) {
        requireAction(actor, reason, occurredAt);
        String url = jdbcUrl();
        try (Connection connection = DriverManager.getConnection(url)) {
            connection.setAutoCommit(false);
            try {
                int version = nextVersion(connection, draft.ruleId());
                insertRule(connection, draft, version, occurredAt);
                insertValues(connection, "rule_languages", "language", draft.ruleId(), version, draft.languages());
                insertValues(connection, "rule_frameworks", "framework", draft.ruleId(), version, draft.frameworks());
                insertSamples(connection, draft.ruleId(), version, "POSITIVE", draft.positiveSamples());
                insertSamples(connection, draft.ruleId(), version, "NEGATIVE", draft.negativeSamples());
                insertAudit(connection, draft.ruleId(), version, "CREATED", actor, reason, occurredAt);
                connection.commit();
                return load(connection, draft.ruleId(), version).orElseThrow();
            } catch (RuntimeException | SQLException e) {
                rollback(connection);
                throw e;
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to create rule candidate '" + draft.ruleId() + "'", e);
        }
    }

    /** {@inheritDoc} */
    @Override
    public DetectionRule submitForReview(
            String ruleId, int version, String actor, String reason, String occurredAt) {
        return transition(ruleId, version, RuleStatus.CANDIDATE, RuleStatus.IN_REVIEW,
                "SUBMITTED_FOR_REVIEW", actor, reason, occurredAt, false);
    }

    /** {@inheritDoc} */
    @Override
    public DetectionRule publish(
            String ruleId, int version, String actor, String reason, String occurredAt) {
        requireAction(actor, reason, occurredAt);
        DetectionRule rule = find(ruleId, version)
                .orElseThrow(() -> notFound(ruleId, version));
        if (rule.status() != RuleStatus.IN_REVIEW) {
            throw invalidTransition(rule, RuleStatus.PUBLISHED);
        }
        List<String> failures = regressionFailures(rule);
        if (!failures.isEmpty()) {
            throw new RuleTransitionException("Regression gate rejected rule '" + ruleId + "' v" + version
                    + ": " + String.join("; ", failures));
        }

        String url = jdbcUrl();
        try (Connection connection = DriverManager.getConnection(url)) {
            connection.setAutoCommit(false);
            try {
                Optional<DetectionRule> previousActive = findActive(connection, ruleId);
                try (PreparedStatement deactivate = connection.prepareStatement(
                        "UPDATE detection_rule_versions SET active = 0 WHERE rule_id = ? AND active = 1")) {
                    deactivate.setString(1, ruleId);
                    deactivate.executeUpdate();
                }
                int changed = updateStatus(connection, ruleId, version, RuleStatus.IN_REVIEW,
                        RuleStatus.PUBLISHED, true, occurredAt);
                if (changed != 1) {
                    throw new RuleTransitionException("Rule changed concurrently: '" + ruleId + "' v" + version);
                }
                if (previousActive.isPresent() && previousActive.get().version() != version) {
                    insertAudit(connection, ruleId, previousActive.get().version(),
                            "SUPERSEDED", actor, reason, occurredAt);
                }
                insertAudit(connection, ruleId, version, "PUBLISHED", actor, reason, occurredAt);
                connection.commit();
                return load(connection, ruleId, version).orElseThrow();
            } catch (RuntimeException | SQLException e) {
                rollback(connection);
                throw e;
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to publish rule '" + ruleId + "' v" + version, e);
        }
    }

    /** {@inheritDoc} */
    @Override
    public DetectionRule reject(
            String ruleId, int version, String actor, String reason, String occurredAt) {
        return transition(ruleId, version, RuleStatus.IN_REVIEW, RuleStatus.REJECTED,
                "REJECTED", actor, reason, occurredAt, false);
    }

    /** {@inheritDoc} */
    @Override
    public DetectionRule rollback(String ruleId, String actor, String reason, String occurredAt) {
        requireAction(actor, reason, occurredAt);
        String url = jdbcUrl();
        try (Connection connection = DriverManager.getConnection(url)) {
            connection.setAutoCommit(false);
            try {
                DetectionRule current = findActive(connection, ruleId)
                        .orElseThrow(() -> new RuleTransitionException(
                                "No active published version for rule '" + ruleId + "'"));
                DetectionRule previous = findPreviousPublished(connection, ruleId, current.version())
                        .orElseThrow(() -> new RuleTransitionException(
                                "No previous published version for rule '" + ruleId + "'"));
                updateStatus(connection, ruleId, current.version(), RuleStatus.PUBLISHED,
                        RuleStatus.ROLLED_BACK, false, occurredAt);
                setActive(connection, ruleId, previous.version(), true, occurredAt);
                insertAudit(connection, ruleId, current.version(), "ROLLED_BACK", actor, reason, occurredAt);
                insertAudit(connection, ruleId, previous.version(), "RESTORED", actor, reason, occurredAt);
                connection.commit();
                return load(connection, ruleId, previous.version()).orElseThrow();
            } catch (RuntimeException | SQLException e) {
                rollback(connection);
                throw e;
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to roll back rule '" + ruleId + "'", e);
        }
    }

    /** {@inheritDoc} */
    @Override
    public Optional<DetectionRule> find(String ruleId, int version) {
        try (Connection connection = DriverManager.getConnection(jdbcUrl())) {
            return load(connection, ruleId, version);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to find rule '" + ruleId + "' v" + version, e);
        }
    }

    /** {@inheritDoc} */
    @Override
    public Optional<DetectionRule> findActive(String ruleId) {
        try (Connection connection = DriverManager.getConnection(jdbcUrl())) {
            return findActive(connection, ruleId);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to find active rule '" + ruleId + "'", e);
        }
    }

    /** {@inheritDoc} */
    @Override
    public List<DetectionRule> list(String ruleId) {
        String sql = ruleId == null || ruleId.isBlank()
                ? "SELECT rule_id, version FROM detection_rule_versions ORDER BY rule_id, version DESC"
                : "SELECT rule_id, version FROM detection_rule_versions WHERE rule_id = ? ORDER BY version DESC";
        List<DetectionRule> rules = new ArrayList<>();
        try (Connection connection = DriverManager.getConnection(jdbcUrl());
             PreparedStatement statement = connection.prepareStatement(sql)) {
            if (ruleId != null && !ruleId.isBlank()) {
                statement.setString(1, ruleId);
            }
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    load(connection, resultSet.getString("rule_id"), resultSet.getInt("version"))
                            .ifPresent(rules::add);
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to list rules", e);
        }
        return List.copyOf(rules);
    }

    /** {@inheritDoc} */
    @Override
    public List<RuleAuditEvent> audit(String ruleId) {
        List<RuleAuditEvent> events = new ArrayList<>();
        try (Connection connection = DriverManager.getConnection(jdbcUrl());
             PreparedStatement statement = connection.prepareStatement("""
                     SELECT * FROM detection_rule_audit
                     WHERE rule_id = ? ORDER BY occurred_at, id
                     """)) {
            statement.setString(1, ruleId);
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    events.add(new RuleAuditEvent(
                            resultSet.getString("id"),
                            resultSet.getString("rule_id"),
                            resultSet.getInt("version"),
                            resultSet.getString("action"),
                            resultSet.getString("actor"),
                            resultSet.getString("reason"),
                            resultSet.getString("occurred_at")));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to query rule audit for '" + ruleId + "'", e);
        }
        return List.copyOf(events);
    }

    private DetectionRule transition(
            String ruleId,
            int version,
            RuleStatus expected,
            RuleStatus target,
            String action,
            String actor,
            String reason,
            String occurredAt,
            boolean active) {
        requireAction(actor, reason, occurredAt);
        DetectionRule rule = find(ruleId, version).orElseThrow(() -> notFound(ruleId, version));
        if (rule.status() != expected) {
            throw invalidTransition(rule, target);
        }
        try (Connection connection = DriverManager.getConnection(jdbcUrl())) {
            connection.setAutoCommit(false);
            try {
                if (updateStatus(connection, ruleId, version, expected, target, active, occurredAt) != 1) {
                    throw new RuleTransitionException("Rule changed concurrently: '" + ruleId + "' v" + version);
                }
                insertAudit(connection, ruleId, version, action, actor, reason, occurredAt);
                connection.commit();
                return load(connection, ruleId, version).orElseThrow();
            } catch (RuntimeException | SQLException e) {
                rollback(connection);
                throw e;
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to transition rule '" + ruleId + "' v" + version, e);
        }
    }

    private List<String> regressionFailures(DetectionRule rule) {
        List<String> failures = new ArrayList<>();
        Pattern regex = null;
        if (rule.matcherKind() == RuleMatcherKind.REGEX) {
            try {
                regex = Pattern.compile(rule.pattern(), Pattern.DOTALL);
            } catch (PatternSyntaxException e) {
                return List.of("invalid regex: " + e.getDescription());
            }
        }
        for (int index = 0; index < rule.positiveSamples().size(); index++) {
            if (!matches(rule, regex, rule.positiveSamples().get(index))) {
                failures.add("positive sample " + index + " did not match");
            }
        }
        for (int index = 0; index < rule.negativeSamples().size(); index++) {
            if (matches(rule, regex, rule.negativeSamples().get(index))) {
                failures.add("negative sample " + index + " matched");
            }
        }
        return failures;
    }

    private static boolean matches(DetectionRule rule, Pattern regex, String sample) {
        return rule.matcherKind() == RuleMatcherKind.SUBSTRING
                ? sample.contains(rule.pattern())
                : regex.matcher(sample).find();
    }

    private void initTables() {
        try (Connection connection = DriverManager.getConnection(jdbcUrl());
             Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS detection_rule_versions (
                        rule_id TEXT NOT NULL,
                        version INTEGER NOT NULL,
                        source TEXT NOT NULL,
                        cwe TEXT NOT NULL,
                        severity TEXT NOT NULL,
                        title TEXT NOT NULL,
                        matcher_kind TEXT NOT NULL,
                        pattern TEXT NOT NULL,
                        status TEXT NOT NULL,
                        change_notes TEXT NOT NULL,
                        active INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (rule_id, version)
                    )
                    """);
            statement.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS rule_languages (
                        rule_id TEXT NOT NULL, version INTEGER NOT NULL,
                        item_index INTEGER NOT NULL, language TEXT NOT NULL,
                        PRIMARY KEY (rule_id, version, item_index)
                    )
                    """);
            statement.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS rule_frameworks (
                        rule_id TEXT NOT NULL, version INTEGER NOT NULL,
                        item_index INTEGER NOT NULL, framework TEXT NOT NULL,
                        PRIMARY KEY (rule_id, version, item_index)
                    )
                    """);
            statement.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS rule_regression_samples (
                        rule_id TEXT NOT NULL, version INTEGER NOT NULL,
                        sample_type TEXT NOT NULL, item_index INTEGER NOT NULL, content TEXT NOT NULL,
                        PRIMARY KEY (rule_id, version, sample_type, item_index)
                    )
                    """);
            statement.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS detection_rule_audit (
                        id TEXT PRIMARY KEY,
                        rule_id TEXT NOT NULL,
                        version INTEGER NOT NULL,
                        action TEXT NOT NULL,
                        actor TEXT NOT NULL,
                        reason TEXT NOT NULL,
                        occurred_at TEXT NOT NULL
                    )
                    """);
            statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_detection_rule_active "
                    + "ON detection_rule_versions(rule_id, active)");
            statement.executeUpdate("CREATE UNIQUE INDEX IF NOT EXISTS idx_detection_rule_one_active "
                    + "ON detection_rule_versions(rule_id) WHERE active = 1");
            statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_detection_rule_audit "
                    + "ON detection_rule_audit(rule_id, occurred_at)");
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to initialize rule registry tables", e);
        }
    }

    private static int nextVersion(Connection connection, String ruleId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM detection_rule_versions WHERE rule_id = ?")) {
            statement.setString(1, ruleId);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.getInt(1);
            }
        }
    }

    private static void insertRule(
            Connection connection, DetectionRuleDraft draft, int version, String occurredAt) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO detection_rule_versions
                    (rule_id, version, source, cwe, severity, title, matcher_kind, pattern,
                     status, change_notes, active, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """)) {
            statement.setString(1, draft.ruleId());
            statement.setInt(2, version);
            statement.setString(3, draft.source());
            statement.setString(4, draft.cwe());
            statement.setString(5, draft.severity().name());
            statement.setString(6, draft.title());
            statement.setString(7, draft.matcherKind().name());
            statement.setString(8, draft.pattern());
            statement.setString(9, RuleStatus.CANDIDATE.name());
            statement.setString(10, draft.changeNotes());
            statement.setInt(11, 0);
            statement.setString(12, occurredAt);
            statement.setString(13, occurredAt);
            statement.executeUpdate();
        }
    }

    private static void insertValues(
            Connection connection,
            String table,
            String column,
            String ruleId,
            int version,
            List<String> values) throws SQLException {
        String sql = "INSERT INTO " + table + " (rule_id, version, item_index, " + column + ") VALUES (?,?,?,?)";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < values.size(); index++) {
                statement.setString(1, ruleId);
                statement.setInt(2, version);
                statement.setInt(3, index);
                statement.setString(4, values.get(index));
                statement.addBatch();
            }
            statement.executeBatch();
        }
    }

    private static void insertSamples(
            Connection connection, String ruleId, int version, String type, List<String> samples) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO rule_regression_samples
                    (rule_id, version, sample_type, item_index, content) VALUES (?,?,?,?,?)
                """)) {
            for (int index = 0; index < samples.size(); index++) {
                statement.setString(1, ruleId);
                statement.setInt(2, version);
                statement.setString(3, type);
                statement.setInt(4, index);
                statement.setString(5, samples.get(index));
                statement.addBatch();
            }
            statement.executeBatch();
        }
    }

    private static int updateStatus(
            Connection connection,
            String ruleId,
            int version,
            RuleStatus expected,
            RuleStatus target,
            boolean active,
            String occurredAt) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                UPDATE detection_rule_versions SET status = ?, active = ?, updated_at = ?
                WHERE rule_id = ? AND version = ? AND status = ?
                """)) {
            statement.setString(1, target.name());
            statement.setInt(2, active ? 1 : 0);
            statement.setString(3, occurredAt);
            statement.setString(4, ruleId);
            statement.setInt(5, version);
            statement.setString(6, expected.name());
            return statement.executeUpdate();
        }
    }

    private static void setActive(
            Connection connection, String ruleId, int version, boolean active, String occurredAt) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                UPDATE detection_rule_versions SET active = ?, updated_at = ?
                WHERE rule_id = ? AND version = ?
                """)) {
            statement.setInt(1, active ? 1 : 0);
            statement.setString(2, occurredAt);
            statement.setString(3, ruleId);
            statement.setInt(4, version);
            statement.executeUpdate();
        }
    }

    private Optional<DetectionRule> load(Connection connection, String ruleId, int version) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT * FROM detection_rule_versions WHERE rule_id = ? AND version = ?")) {
            statement.setString(1, ruleId);
            statement.setInt(2, version);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(fromRow(connection, resultSet));
            }
        }
    }

    private Optional<DetectionRule> findActive(Connection connection, String ruleId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT * FROM detection_rule_versions
                WHERE rule_id = ? AND active = 1 AND status = 'PUBLISHED'
                """)) {
            statement.setString(1, ruleId);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next() ? Optional.of(fromRow(connection, resultSet)) : Optional.empty();
            }
        }
    }

    private Optional<DetectionRule> findPreviousPublished(
            Connection connection, String ruleId, int currentVersion) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT * FROM detection_rule_versions
                WHERE rule_id = ? AND version < ? AND status = 'PUBLISHED'
                ORDER BY version DESC LIMIT 1
                """)) {
            statement.setString(1, ruleId);
            statement.setInt(2, currentVersion);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next() ? Optional.of(fromRow(connection, resultSet)) : Optional.empty();
            }
        }
    }

    private DetectionRule fromRow(Connection connection, ResultSet resultSet) throws SQLException {
        String ruleId = resultSet.getString("rule_id");
        int version = resultSet.getInt("version");
        return new DetectionRule(
                ruleId,
                version,
                resultSet.getString("source"),
                loadValues(connection, "rule_languages", "language", ruleId, version),
                loadValues(connection, "rule_frameworks", "framework", ruleId, version),
                resultSet.getString("cwe"),
                ExternalFindingSeverity.valueOf(resultSet.getString("severity")),
                resultSet.getString("title"),
                RuleMatcherKind.valueOf(resultSet.getString("matcher_kind")),
                resultSet.getString("pattern"),
                RuleStatus.valueOf(resultSet.getString("status")),
                loadSamples(connection, ruleId, version, "POSITIVE"),
                loadSamples(connection, ruleId, version, "NEGATIVE"),
                resultSet.getString("change_notes"),
                resultSet.getInt("active") == 1,
                resultSet.getString("created_at"),
                resultSet.getString("updated_at"));
    }

    private static List<String> loadValues(
            Connection connection, String table, String column, String ruleId, int version) throws SQLException {
        String sql = "SELECT " + column + " FROM " + table
                + " WHERE rule_id = ? AND version = ? ORDER BY item_index";
        List<String> values = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, ruleId);
            statement.setInt(2, version);
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    values.add(resultSet.getString(1));
                }
            }
        }
        return List.copyOf(values);
    }

    private static List<String> loadSamples(
            Connection connection, String ruleId, int version, String type) throws SQLException {
        List<String> samples = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT content FROM rule_regression_samples
                WHERE rule_id = ? AND version = ? AND sample_type = ? ORDER BY item_index
                """)) {
            statement.setString(1, ruleId);
            statement.setInt(2, version);
            statement.setString(3, type);
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    samples.add(resultSet.getString(1));
                }
            }
        }
        return List.copyOf(samples);
    }

    private static void insertAudit(
            Connection connection,
            String ruleId,
            int version,
            String action,
            String actor,
            String reason,
            String occurredAt) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO detection_rule_audit
                    (id, rule_id, version, action, actor, reason, occurred_at) VALUES (?,?,?,?,?,?,?)
                """)) {
            statement.setString(1, UUID.randomUUID().toString());
            statement.setString(2, ruleId);
            statement.setInt(3, version);
            statement.setString(4, action);
            statement.setString(5, actor.trim());
            statement.setString(6, reason.trim());
            statement.setString(7, occurredAt.trim());
            statement.executeUpdate();
        }
    }

    private String jdbcUrl() {
        return "jdbc:sqlite:" + dbPath;
    }

    private static void requireAction(String actor, String reason, String occurredAt) {
        if (actor == null || actor.isBlank()) {
            throw new IllegalArgumentException("actor is required");
        }
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("reason is required");
        }
        if (occurredAt == null || occurredAt.isBlank()) {
            throw new IllegalArgumentException("occurredAt is required");
        }
    }

    private static RuleNotFoundException notFound(String ruleId, int version) {
        return new RuleNotFoundException("Rule not found: '" + ruleId + "' v" + version);
    }

    private static RuleTransitionException invalidTransition(DetectionRule rule, RuleStatus target) {
        return new RuleTransitionException("Cannot transition rule '" + rule.ruleId() + "' v" + rule.version()
                + " from " + rule.status() + " to " + target);
    }

    private static void rollback(Connection connection) {
        try {
            connection.rollback();
        } catch (SQLException ignored) {
            // 保留原始失败；回滚失败会由 SQLite 在连接关闭时清理事务。
        }
    }
}
