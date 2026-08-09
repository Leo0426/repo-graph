package com.repograph.agent;

import com.repograph.core.agent.AgentPlaybook;
import com.repograph.core.agent.AgentRun;
import com.repograph.core.agent.AgentRunRepository;
import com.repograph.core.agent.AgentRunStatus;
import com.repograph.core.agent.AgentStep;
import com.repograph.core.agent.AgentStepStatus;
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

/**
 * Agent 运行、公开步骤及事实引用的 SQLite 存储。
 *
 * @author leolu
 */
@Service
public class AgentRunStore implements AgentRunRepository {

    private static final int MAX_LIST_LIMIT = 100;

    private final String dbPath;

    /**
     * 创建 Agent 运行存储。
     *
     * @param dbPath SQLite 数据库路径
     */
    public AgentRunStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath) {
        this.dbPath = dbPath;
        initTables();
    }

    @Override
    public void create(AgentRun run) {
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement("""
                     INSERT INTO agent_runs
                         (id, project_id, playbook, playbook_version, status, input_reference,
                          output_reference, status_reason, created_at, updated_at, completed_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)
                     """)) {
            statement.setString(1, run.id());
            statement.setString(2, run.projectId());
            statement.setString(3, run.playbook().name());
            statement.setString(4, run.playbookVersion());
            statement.setString(5, run.status().name());
            statement.setString(6, safe(run.inputReference()));
            statement.setString(7, safe(run.outputReference()));
            statement.setString(8, safe(run.statusReason()));
            statement.setString(9, run.createdAt());
            statement.setString(10, run.updatedAt());
            statement.setString(11, safe(run.completedAt()));
            statement.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to create agent run '" + run.id() + "'", e);
        }
    }

    @Override
    public void appendStep(AgentStep step) {
        try (Connection connection = connection()) {
            connection.setAutoCommit(false);
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO agent_steps
                        (id, run_id, sequence_no, capability, status, summary, error,
                         started_at, finished_at)
                    VALUES (?,?,?,?,?,?,?,?,?)
                    """)) {
                statement.setString(1, step.id());
                statement.setString(2, step.runId());
                statement.setInt(3, step.sequence());
                statement.setString(4, step.capability());
                statement.setString(5, step.status().name());
                statement.setString(6, safe(step.summary()));
                statement.setString(7, safe(step.error()));
                statement.setString(8, safe(step.startedAt()));
                statement.setString(9, safe(step.finishedAt()));
                statement.executeUpdate();
            }
            insertReferences(connection, step.id(), "EVIDENCE", step.evidenceReferences());
            insertReferences(connection, step.id(), "MISSING", step.missingInfo());
            connection.commit();
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to append agent step '" + step.id() + "'", e);
        }
    }

    @Override
    public void transition(String runId, AgentRunStatus status, String outputReference,
                           String statusReason, String occurredAt) {
        Instant.parse(occurredAt);
        String completedAt = status.terminal() ? occurredAt : "";
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement("""
                     UPDATE agent_runs
                     SET status = ?, output_reference = ?, status_reason = ?,
                         updated_at = ?, completed_at = ?
                     WHERE id = ?
                     """)) {
            statement.setString(1, status.name());
            statement.setString(2, safe(outputReference));
            statement.setString(3, safe(statusReason));
            statement.setString(4, occurredAt);
            statement.setString(5, completedAt);
            statement.setString(6, runId);
            if (statement.executeUpdate() == 0) {
                throw new IllegalArgumentException("Agent run not found: " + runId);
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to transition agent run '" + runId + "'", e);
        }
    }

    @Override
    public Optional<AgentRun> get(String runId) {
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT * FROM agent_runs WHERE id = ?")) {
            statement.setString(1, runId);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next()
                        ? Optional.of(fromRow(connection, resultSet))
                        : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to get agent run '" + runId + "'", e);
        }
    }

    @Override
    public List<AgentRun> list(String projectId, int limit) {
        int capped = Math.max(1, Math.min(limit, MAX_LIST_LIMIT));
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement("""
                     SELECT * FROM agent_runs
                     WHERE project_id = ?
                     ORDER BY created_at DESC, id DESC
                     LIMIT ?
                     """)) {
            statement.setString(1, projectId);
            statement.setInt(2, capped);
            List<AgentRun> runs = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    runs.add(fromRow(connection, resultSet));
                }
            }
            return List.copyOf(runs);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to list agent runs", e);
        }
    }

    private AgentRun fromRow(Connection connection, ResultSet row) throws SQLException {
        String id = row.getString("id");
        return new AgentRun(
                id,
                row.getString("project_id"),
                AgentPlaybook.valueOf(row.getString("playbook")),
                row.getString("playbook_version"),
                AgentRunStatus.valueOf(row.getString("status")),
                row.getString("input_reference"),
                row.getString("output_reference"),
                row.getString("status_reason"),
                row.getString("created_at"),
                row.getString("updated_at"),
                row.getString("completed_at"),
                loadSteps(connection, id));
    }

    private List<AgentStep> loadSteps(Connection connection, String runId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT * FROM agent_steps WHERE run_id = ? ORDER BY sequence_no, id
                """)) {
            statement.setString(1, runId);
            List<AgentStep> steps = new ArrayList<>();
            try (ResultSet row = statement.executeQuery()) {
                while (row.next()) {
                    String stepId = row.getString("id");
                    steps.add(new AgentStep(
                            stepId,
                            runId,
                            row.getInt("sequence_no"),
                            row.getString("capability"),
                            AgentStepStatus.valueOf(row.getString("status")),
                            row.getString("summary"),
                            loadReferences(connection, stepId, "EVIDENCE"),
                            loadReferences(connection, stepId, "MISSING"),
                            row.getString("error"),
                            row.getString("started_at"),
                            row.getString("finished_at")));
                }
            }
            return List.copyOf(steps);
        }
    }

    private static void insertReferences(
            Connection connection, String stepId, String kind, List<String> references) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO agent_step_references (step_id, kind, position, reference_value)
                VALUES (?,?,?,?)
                """)) {
            for (int index = 0; index < references.size(); index++) {
                statement.setString(1, stepId);
                statement.setString(2, kind);
                statement.setInt(3, index);
                statement.setString(4, references.get(index));
                statement.addBatch();
            }
            statement.executeBatch();
        }
    }

    private static List<String> loadReferences(
            Connection connection, String stepId, String kind) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT reference_value FROM agent_step_references
                WHERE step_id = ? AND kind = ? ORDER BY position
                """)) {
            statement.setString(1, stepId);
            statement.setString(2, kind);
            List<String> references = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    references.add(resultSet.getString(1));
                }
            }
            return List.copyOf(references);
        }
    }

    private void initTables() {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS agent_runs (
                        id               TEXT PRIMARY KEY,
                        project_id       TEXT NOT NULL,
                        playbook         TEXT NOT NULL,
                        playbook_version TEXT NOT NULL,
                        status           TEXT NOT NULL,
                        input_reference  TEXT NOT NULL,
                        output_reference TEXT NOT NULL,
                        status_reason    TEXT NOT NULL,
                        created_at       TEXT NOT NULL,
                        updated_at       TEXT NOT NULL,
                        completed_at     TEXT NOT NULL
                    )
                    """);
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS agent_steps (
                        id          TEXT PRIMARY KEY,
                        run_id      TEXT NOT NULL,
                        sequence_no INTEGER NOT NULL,
                        capability  TEXT NOT NULL,
                        status      TEXT NOT NULL,
                        summary     TEXT NOT NULL,
                        error       TEXT NOT NULL,
                        started_at  TEXT NOT NULL,
                        finished_at TEXT NOT NULL,
                        UNIQUE(run_id, sequence_no)
                    )
                    """);
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS agent_step_references (
                        step_id         TEXT NOT NULL,
                        kind            TEXT NOT NULL,
                        position        INTEGER NOT NULL,
                        reference_value TEXT NOT NULL,
                        PRIMARY KEY(step_id, kind, position)
                    )
                    """);
            statement.execute("""
                    CREATE INDEX IF NOT EXISTS idx_agent_runs_project
                    ON agent_runs(project_id, created_at DESC)
                    """);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to initialize agent run tables", e);
        }
    }

    private Connection connection() throws SQLException {
        return DriverManager.getConnection("jdbc:sqlite:" + dbPath);
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }
}
