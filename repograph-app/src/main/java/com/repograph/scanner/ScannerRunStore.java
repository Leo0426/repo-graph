package com.repograph.scanner;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.scanner.ScannerRunResult;
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
 * 外部扫描运行与归一化报警的 SQLite 存储。
 *
 * @author leolu
 */
@Service
public class ScannerRunStore {

    private final String dbPath;
    private final ObjectMapper objectMapper;

    /**
     * 创建扫描运行存储并初始化表。
     *
     * @param dbPath      SQLite 数据库路径
     * @param objectMapper JSON 序列化器
     */
    public ScannerRunStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath,
            ObjectMapper objectMapper) {
        this.dbPath = dbPath;
        this.objectMapper = objectMapper;
        initTables();
    }

    /**
     * 保存一次扫描运行，并按项目和报警指纹幂等写入报警。
     *
     * @param batchId 扫描批次标识
     * @param result  扫描结果
     */
    public void save(String batchId, ScannerRunResult result) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection connection = DriverManager.getConnection(url)) {
            connection.setAutoCommit(false);
            try {
                saveRun(connection, batchId, result);
                saveFindings(connection, result);
                connection.commit();
            } catch (SQLException | JsonProcessingException e) {
                connection.rollback();
                throw new IllegalStateException("Failed to save scanner run", e);
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to open scanner run database", e);
        }
    }

    /**
     * 查询单次扫描运行。
     *
     * @param scanId 扫描运行标识
     * @return 扫描运行
     */
    public Optional<ScannerRunResult> findRun(String scanId) {
        String sql = "SELECT result_json FROM scanner_runs WHERE scan_id = ?";
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, scanId);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next()
                        ? Optional.of(readRun(resultSet.getString("result_json")))
                        : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to query scanner run", e);
        }
    }

    /**
     * 查询项目扫描历史。
     *
     * @param projectId 项目标识
     * @return 按开始时间倒序的运行
     */
    public List<ScannerRunResult> listRuns(String projectId) {
        String sql = """
                SELECT result_json FROM scanner_runs
                WHERE project_id = ?
                ORDER BY started_at DESC, scan_id DESC
                """;
        List<ScannerRunResult> runs = new ArrayList<>();
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, projectId);
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    runs.add(readRun(resultSet.getString("result_json")));
                }
            }
            return List.copyOf(runs);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to list scanner runs", e);
        }
    }

    /**
     * 查询项目按指纹去重后的报警。
     *
     * @param projectId 项目标识
     * @return 去重报警
     */
    public List<ExternalFinding> listFindings(String projectId) {
        String sql = """
                SELECT finding_json FROM external_findings
                WHERE project_id = ?
                ORDER BY last_seen_at DESC, fingerprint
                """;
        List<ExternalFinding> findings = new ArrayList<>();
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, projectId);
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    findings.add(readFinding(resultSet.getString("finding_json")));
                }
            }
            return List.copyOf(findings);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to list external findings", e);
        }
    }

    /**
     * 查询项目关联的去重扫描批次标识。
     *
     * @param projectId 项目标识
     * @return 批次标识
     */
    public List<String> listBatchIds(String projectId) {
        String sql = """
                SELECT DISTINCT batch_id FROM scanner_runs
                WHERE project_id = ?
                ORDER BY batch_id
                """;
        List<String> batchIds = new ArrayList<>();
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, projectId);
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    batchIds.add(resultSet.getString("batch_id"));
                }
            }
            return List.copyOf(batchIds);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to list scanner batch identifiers", e);
        }
    }

    /**
     * 删除项目全部扫描历史和外部报警。
     *
     * @param projectId 项目标识
     */
    public void removeProject(String projectId) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection connection = DriverManager.getConnection(url)) {
            connection.setAutoCommit(false);
            try (PreparedStatement findings = connection.prepareStatement(
                    "DELETE FROM external_findings WHERE project_id = ?");
                 PreparedStatement runs = connection.prepareStatement(
                         "DELETE FROM scanner_runs WHERE project_id = ?")) {
                findings.setString(1, projectId);
                findings.executeUpdate();
                runs.setString(1, projectId);
                runs.executeUpdate();
                connection.commit();
            } catch (SQLException e) {
                connection.rollback();
                throw e;
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to remove project scanner data", e);
        }
    }

    private void saveRun(Connection connection, String batchId, ScannerRunResult result)
            throws SQLException, JsonProcessingException {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO scanner_runs
                    (scan_id, batch_id, project_id, scanner, status, started_at, result_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(scan_id) DO UPDATE SET
                    status = excluded.status,
                    result_json = excluded.result_json
                """)) {
            statement.setString(1, result.scanId());
            statement.setString(2, batchId);
            statement.setString(3, result.projectId());
            statement.setString(4, result.scanner());
            statement.setString(5, result.status().name());
            statement.setString(6, result.startedAt());
            statement.setString(7, objectMapper.writeValueAsString(result));
            statement.executeUpdate();
        }
    }

    private void saveFindings(Connection connection, ScannerRunResult result)
            throws SQLException, JsonProcessingException {
        if (result.findings().isEmpty()) {
            return;
        }
        String now = Instant.now().toString();
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO external_findings
                    (project_id, fingerprint, scanner, scan_id, finding_json, first_seen_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, fingerprint) DO UPDATE SET
                    scanner = excluded.scanner,
                    scan_id = excluded.scan_id,
                    finding_json = excluded.finding_json,
                    last_seen_at = excluded.last_seen_at
                """)) {
            for (ExternalFinding finding : result.findings()) {
                statement.setString(1, result.projectId());
                statement.setString(2, finding.fingerprint());
                statement.setString(3, result.scanner());
                statement.setString(4, result.scanId());
                statement.setString(5, objectMapper.writeValueAsString(finding));
                statement.setString(6, now);
                statement.setString(7, now);
                statement.addBatch();
            }
            statement.executeBatch();
        }
    }

    private ScannerRunResult readRun(String json) {
        try {
            return objectMapper.readValue(json, ScannerRunResult.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Stored scanner run JSON is invalid", e);
        }
    }

    private ExternalFinding readFinding(String json) {
        try {
            return objectMapper.readValue(json, ExternalFinding.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Stored external finding JSON is invalid", e);
        }
    }

    private void initTables() {
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
             Statement statement = connection.createStatement()) {
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS scanner_runs (
                        scan_id     TEXT PRIMARY KEY,
                        batch_id    TEXT NOT NULL,
                        project_id  TEXT NOT NULL,
                        scanner     TEXT NOT NULL,
                        status      TEXT NOT NULL,
                        started_at  TEXT NOT NULL,
                        result_json TEXT NOT NULL
                    )
                    """);
            statement.execute("""
                    CREATE INDEX IF NOT EXISTS idx_scanner_runs_project
                    ON scanner_runs(project_id, started_at DESC)
                    """);
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS external_findings (
                        project_id    TEXT NOT NULL,
                        fingerprint   TEXT NOT NULL,
                        scanner       TEXT NOT NULL,
                        scan_id       TEXT NOT NULL,
                        finding_json  TEXT NOT NULL,
                        first_seen_at TEXT NOT NULL,
                        last_seen_at  TEXT NOT NULL,
                        PRIMARY KEY(project_id, fingerprint)
                    )
                    """);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to initialize scanner run tables", e);
        }
    }
}
