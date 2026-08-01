package com.repograph.scanner;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.scanner.ExternalScanBatchResult;
import com.repograph.core.scanner.ScanTask;
import com.repograph.core.scanner.ScanTaskFindingsPage;
import com.repograph.core.scanner.ScanTaskStatus;
import com.repograph.core.scanner.ScannerRunResult;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 异步扫描任务及其批次结果快照的 SQLite 存储。状态迁移在单事务内做条件 {@code UPDATE}，
 * 仅当当前状态匹配时才生效，避免竞态改写。
 *
 * @author leolu
 */
@Component
public class ScanTaskStore {

    private final String dbPath;
    private final ObjectMapper objectMapper;

    /**
     * 创建扫描任务存储。
     *
     * @param dbPath       SQLite 数据库路径
     * @param objectMapper 批次快照序列化使用的 Jackson mapper
     */
    public ScanTaskStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath,
            ObjectMapper objectMapper) {
        this.dbPath = dbPath;
        this.objectMapper = objectMapper;
        initTables();
    }

    /**
     * 持久化一条新任务（通常为 {@code QUEUED}）。
     *
     * @param task 任务
     */
    public void create(ScanTask task) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement("""
                     INSERT INTO scan_tasks
                         (id, project_id, asset_id, scanners, languages, timeout_seconds,
                          status, attempt, batch_id, error, batch_json, created_at, updated_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                     """)) {
            statement.setString(1, task.id());
            statement.setString(2, task.projectId());
            statement.setString(3, task.assetId());
            statement.setString(4, writeJson(task.scanners()));
            statement.setString(5, writeJson(task.languages()));
            statement.setLong(6, task.timeoutSeconds());
            statement.setString(7, task.status().name());
            statement.setInt(8, task.attempt());
            statement.setString(9, task.batchId());
            statement.setString(10, task.error());
            statement.setString(11, null);
            statement.setString(12, task.createdAt());
            statement.setString(13, task.updatedAt());
            statement.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to create scan task '" + task.id() + "'", e);
        }
    }

    /**
     * 按标识查询任务。
     *
     * @param taskId 任务标识
     * @return 任务；不存在时为空
     */
    public Optional<ScanTask> find(String taskId) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement(
                     "SELECT * FROM scan_tasks WHERE id = ?")) {
            statement.setString(1, taskId);
            try (ResultSet rs = statement.executeQuery()) {
                return rs.next() ? Optional.of(fromRow(rs)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to query scan task '" + taskId + "'", e);
        }
    }

    /**
     * 将任务从 {@code QUEUED} 迁移到 {@code RUNNING}。
     *
     * @param taskId     任务标识
     * @param occurredAt 操作时间
     * @return 是否真正发生迁移
     */
    public boolean markRunning(String taskId, String occurredAt) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement("""
                     UPDATE scan_tasks SET status = 'RUNNING', updated_at = ?
                     WHERE id = ? AND status = 'QUEUED'
                     """)) {
            statement.setString(1, occurredAt);
            statement.setString(2, taskId);
            return statement.executeUpdate() > 0;
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to mark scan task running '" + taskId + "'", e);
        }
    }

    /**
     * 将任务从 {@code RUNNING} 迁移到终态，并写入批次结果快照。
     *
     * @param taskId     任务标识
     * @param batch      批次执行结果
     * @param terminal   终态（{@code SUCCEEDED / PARTIAL / FAILED}）
     * @param occurredAt 操作时间
     * @return 是否真正发生迁移
     */
    public boolean complete(String taskId, ExternalScanBatchResult batch,
                            ScanTaskStatus terminal, String occurredAt) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement("""
                     UPDATE scan_tasks SET status = ?, batch_id = ?, batch_json = ?, updated_at = ?
                     WHERE id = ? AND status = 'RUNNING'
                     """)) {
            statement.setString(1, terminal.name());
            statement.setString(2, batch.batchId());
            statement.setString(3, writeJson(batch));
            statement.setString(4, occurredAt);
            statement.setString(5, taskId);
            return statement.executeUpdate() > 0;
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to complete scan task '" + taskId + "'", e);
        }
    }

    /**
     * 将任务从 {@code RUNNING} 迁移到 {@code FAILED}，记录任务级失败原因。
     *
     * @param taskId     任务标识
     * @param error      结构化失败摘要
     * @param occurredAt 操作时间
     * @return 是否真正发生迁移
     */
    public boolean fail(String taskId, String error, String occurredAt) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement("""
                     UPDATE scan_tasks SET status = 'FAILED', error = ?, updated_at = ?
                     WHERE id = ? AND status = 'RUNNING'
                     """)) {
            statement.setString(1, error);
            statement.setString(2, occurredAt);
            statement.setString(3, taskId);
            return statement.executeUpdate() > 0;
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to fail scan task '" + taskId + "'", e);
        }
    }

    /**
     * 读取任务的批次结果快照。
     *
     * @param taskId 任务标识
     * @return 批次结果；任务未完成或不存在时为空
     */
    public Optional<ExternalScanBatchResult> result(String taskId) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement statement = conn.prepareStatement(
                     "SELECT batch_json FROM scan_tasks WHERE id = ?")) {
            statement.setString(1, taskId);
            try (ResultSet rs = statement.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                String json = rs.getString("batch_json");
                if (json == null || json.isBlank()) {
                    return Optional.empty();
                }
                return Optional.of(readBatch(taskId, json));
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to read scan task result '" + taskId + "'", e);
        }
    }

    /**
     * 分页查询任务去重后的归一化报警。跨扫描器按 {@link ExternalFinding#fingerprint()} 去重，
     * 保留首次出现顺序。
     *
     * @param taskId 任务标识
     * @param page   页码，从 0 起
     * @param size   每页大小
     * @return 一页报警；任务未完成时为空页
     */
    public ScanTaskFindingsPage findingsPage(String taskId, int page, int size) {
        int safePage = Math.max(0, page);
        int safeSize = Math.max(1, size);
        List<ExternalFinding> all = dedupedFindings(taskId);
        int from = Math.min(safePage * safeSize, all.size());
        int to = Math.min(from + safeSize, all.size());
        return new ScanTaskFindingsPage(all.subList(from, to), safePage, safeSize, all.size());
    }

    private List<ExternalFinding> dedupedFindings(String taskId) {
        Optional<ExternalScanBatchResult> batch = result(taskId);
        if (batch.isEmpty()) {
            return List.of();
        }
        Map<String, ExternalFinding> byFingerprint = new LinkedHashMap<>();
        for (ScannerRunResult run : batch.get().runs()) {
            for (ExternalFinding finding : run.findings()) {
                byFingerprint.putIfAbsent(finding.fingerprint(), finding);
            }
        }
        return new ArrayList<>(byFingerprint.values());
    }

    private void initTables() {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             Statement statement = conn.createStatement()) {
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS scan_tasks (
                        id              TEXT PRIMARY KEY,
                        project_id      TEXT NOT NULL,
                        asset_id        TEXT NOT NULL,
                        scanners        TEXT NOT NULL,
                        languages       TEXT NOT NULL,
                        timeout_seconds INTEGER NOT NULL,
                        status          TEXT NOT NULL,
                        attempt         INTEGER NOT NULL,
                        batch_id        TEXT NOT NULL DEFAULT '',
                        error           TEXT NOT NULL DEFAULT '',
                        batch_json      TEXT,
                        created_at      TEXT NOT NULL,
                        updated_at      TEXT NOT NULL
                    )
                    """);
            statement.execute("""
                    CREATE INDEX IF NOT EXISTS idx_scan_tasks_lookup
                    ON scan_tasks(project_id, status, updated_at)
                    """);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to initialize scan task tables", e);
        }
    }

    private ScanTask fromRow(ResultSet rs) throws SQLException {
        return new ScanTask(
                rs.getString("id"),
                rs.getString("project_id"),
                rs.getString("asset_id"),
                readList(rs.getString("scanners")),
                readList(rs.getString("languages")),
                rs.getLong("timeout_seconds"),
                ScanTaskStatus.valueOf(rs.getString("status")),
                rs.getInt("attempt"),
                rs.getString("batch_id"),
                rs.getString("error"),
                rs.getString("created_at"),
                rs.getString("updated_at"));
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize scan task field", e);
        }
    }

    private List<String> readList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("Failed to deserialize scan task list field", e);
        }
    }

    private ExternalScanBatchResult readBatch(String taskId, String json) {
        try {
            return objectMapper.readValue(json, ExternalScanBatchResult.class);
        } catch (Exception e) {
            throw new IllegalStateException(
                    "Failed to deserialize scan task batch '" + taskId + "'", e);
        }
    }
}
