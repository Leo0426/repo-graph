package com.repograph.vuln;

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

/**
 * 漏洞发现记录的 SQLite 持久化，与增量索引缓存共用同一个 {@code index.db} 文件。
 *
 * <p>每条记录以 {@code id}（projectId + ruleId + unitId 的 SHA256 前缀）为主键，
 * 重复扫描同一 CodeUnit 时仅更新 {@code foundAt}，不创建重复记录。
 *
 * @author leolu
 * @since 0.5.0
 */
@Service
public class VulnStore {

    private static final Logger log = LoggerFactory.getLogger(VulnStore.class);

    private final String dbPath;

    public VulnStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath) {
        this.dbPath = dbPath;
        initTable();
    }

    /**
     * 批量写入或更新漏洞发现记录。对同一 id 已存在的记录，仅更新 {@code found_at}，
     * 保留用户已设置的 {@code status}（不覆盖 CONFIRMED/FIXED/DISMISSED）。
     */
    public void upsertAll(List<VulnFinding> findings) {
        if (findings.isEmpty()) return;
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (PreparedStatement ps = conn.prepareStatement("""
                    INSERT INTO vuln_findings
                        (id, project_id, rule_id, cwe, severity, status,
                         unit_id, qual_name, file_path, start_line, title, detail, found_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET
                        found_at = excluded.found_at
                    """)) {
                for (VulnFinding f : findings) {
                    ps.setString(1, f.id());
                    ps.setString(2, f.projectId());
                    ps.setString(3, f.ruleId());
                    ps.setString(4, f.cwe());
                    ps.setString(5, f.severity());
                    ps.setString(6, f.status());
                    ps.setString(7, f.unitId());
                    ps.setString(8, f.qualifiedName());
                    ps.setString(9, f.filePath());
                    ps.setInt(10, f.startLine());
                    ps.setString(11, f.title());
                    ps.setString(12, f.detail());
                    ps.setString(13, f.foundAt());
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            conn.commit();
        } catch (SQLException e) {
            log.warn("Failed to upsert vuln findings: {}", e.getMessage());
        }
    }

    /**
     * 查询指定项目的漏洞发现列表，支持按 severity 和 status 过滤。
     *
     * @param projectId 项目 ID，不为 {@code null}
     * @param severity  可选，过滤严重程度（HIGH/MEDIUM/LOW）
     * @param status    可选，过滤状态（SUSPECTED/CONFIRMED/FIXED/DISMISSED）
     * @return 按 severity desc, found_at desc 排序的发现列表
     */
    public List<VulnFinding> list(String projectId, String severity, String status) {
        StringBuilder sql = new StringBuilder(
                "SELECT * FROM vuln_findings WHERE project_id = ?");
        List<Object> params = new ArrayList<>();
        params.add(projectId);
        if (severity != null && !severity.isBlank()) {
            sql.append(" AND severity = ?");
            params.add(severity.toUpperCase());
        }
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = ?");
            params.add(status.toUpperCase());
        }
        sql.append(" ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, found_at DESC");

        List<VulnFinding> result = new ArrayList<>();
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(sql.toString())) {
            for (int i = 0; i < params.size(); i++) ps.setObject(i + 1, params.get(i));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) result.add(fromRow(rs));
            }
        } catch (SQLException e) {
            log.warn("Failed to list vuln findings for '{}': {}", projectId, e.getMessage());
        }
        return result;
    }

    /**
     * 更新单条发现记录的状态。
     *
     * @param id     发现记录 ID
     * @param status 新状态，必须是 {@link VulnFinding#VALID_STATUSES} 之一
     * @return 是否找到并更新成功
     */
    public boolean updateStatus(String id, String status) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(
                     "UPDATE vuln_findings SET status = ? WHERE id = ?")) {
            ps.setString(1, status);
            ps.setString(2, id);
            return ps.executeUpdate() > 0;
        } catch (SQLException e) {
            log.warn("Failed to update status for finding '{}': {}", id, e.getMessage());
            return false;
        }
    }

    /** 按 ID 精确查找单条发现记录。 */
    public java.util.Optional<VulnFinding> findById(String id) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT * FROM vuln_findings WHERE id = ?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return java.util.Optional.empty();
                return java.util.Optional.of(fromRow(rs));
            }
        } catch (SQLException e) {
            log.warn("Failed to find vuln finding '{}': {}", id, e.getMessage());
            return java.util.Optional.empty();
        }
    }

    /**
     * 原子替换指定漏洞的污染链源码证据。
     *
     * @param findingId 漏洞 ID
     * @param steps     有序污染链步骤
     */
    public void replaceTaintEvidence(String findingId, List<TaintEvidenceStep> steps) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (PreparedStatement delete = conn.prepareStatement(
                    "DELETE FROM vuln_taint_evidence WHERE finding_id = ?");
                 PreparedStatement insert = conn.prepareStatement("""
                         INSERT INTO vuln_taint_evidence
                             (finding_id, sequence_no, role, method_qn, from_slot, to_slot,
                              file_path, start_line, end_line, source_excerpt)
                         VALUES (?,?,?,?,?,?,?,?,?,?)
                         """)) {
                delete.setString(1, findingId);
                delete.executeUpdate();
                for (TaintEvidenceStep step : steps) {
                    insert.setString(1, findingId);
                    insert.setInt(2, step.sequence());
                    insert.setString(3, step.role());
                    insert.setString(4, step.methodQn());
                    insert.setString(5, step.fromSlot());
                    insert.setString(6, step.toSlot());
                    insert.setString(7, step.filePath());
                    insert.setInt(8, step.startLine());
                    insert.setInt(9, step.endLine());
                    insert.setString(10, step.sourceExcerpt());
                    insert.addBatch();
                }
                insert.executeBatch();
            }
            conn.commit();
        } catch (SQLException e) {
            log.warn("Failed to replace taint evidence for '{}': {}", findingId, e.getMessage());
        }
    }

    /**
     * 查询指定漏洞的污染链源码证据。
     *
     * @param findingId 漏洞 ID
     * @return 按 sequence 排序的证据步骤
     */
    public List<TaintEvidenceStep> findTaintEvidence(String findingId) {
        List<TaintEvidenceStep> result = new ArrayList<>();
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("""
                     SELECT * FROM vuln_taint_evidence
                     WHERE finding_id = ? ORDER BY sequence_no
                     """)) {
            ps.setString(1, findingId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    result.add(new TaintEvidenceStep(
                            rs.getInt("sequence_no"), rs.getString("role"), rs.getString("method_qn"),
                            rs.getString("from_slot"), rs.getString("to_slot"), rs.getString("file_path"),
                            rs.getInt("start_line"), rs.getInt("end_line"), rs.getString("source_excerpt")));
                }
            }
        } catch (SQLException e) {
            log.warn("Failed to load taint evidence for '{}': {}", findingId, e.getMessage());
        }
        return List.copyOf(result);
    }

    /** 删除指定项目的所有漏洞记录，配合项目删除使用。 */
    public void removeProject(String projectId) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (PreparedStatement evidence = conn.prepareStatement("""
                         DELETE FROM vuln_taint_evidence
                         WHERE finding_id IN (SELECT id FROM vuln_findings WHERE project_id = ?)
                         """);
                 PreparedStatement findings = conn.prepareStatement(
                         "DELETE FROM vuln_findings WHERE project_id = ?")) {
                evidence.setString(1, projectId);
                evidence.executeUpdate();
                findings.setString(1, projectId);
                findings.executeUpdate();
            }
            conn.commit();
        } catch (SQLException e) {
            log.warn("Failed to remove vuln findings for '{}': {}", projectId, e.getMessage());
        }
    }

    // ── 内部方法 ──────────────────────────────────────────────────────────────

    private void initTable() {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement()) {
            stmt.execute("""
                    CREATE TABLE IF NOT EXISTS vuln_findings (
                        id          TEXT PRIMARY KEY,
                        project_id  TEXT NOT NULL,
                        rule_id     TEXT NOT NULL,
                        cwe         TEXT NOT NULL,
                        severity    TEXT NOT NULL,
                        status      TEXT NOT NULL DEFAULT 'SUSPECTED',
                        unit_id     TEXT NOT NULL,
                        qual_name   TEXT NOT NULL,
                        file_path   TEXT NOT NULL,
                        start_line  INTEGER,
                        title       TEXT NOT NULL,
                        detail      TEXT,
                        found_at    TEXT NOT NULL
                    )
                    """);
            stmt.execute(
                    "CREATE INDEX IF NOT EXISTS idx_vuln_project ON vuln_findings(project_id)");
            stmt.execute("""
                    CREATE TABLE IF NOT EXISTS vuln_taint_evidence (
                        finding_id     TEXT NOT NULL,
                        sequence_no    INTEGER NOT NULL,
                        role           TEXT NOT NULL,
                        method_qn      TEXT NOT NULL,
                        from_slot      TEXT NOT NULL,
                        to_slot        TEXT NOT NULL,
                        file_path      TEXT NOT NULL,
                        start_line     INTEGER NOT NULL,
                        end_line       INTEGER NOT NULL,
                        source_excerpt TEXT NOT NULL,
                        PRIMARY KEY (finding_id, sequence_no)
                    )
                    """);
        } catch (SQLException e) {
            log.warn("Failed to init vuln_findings table: {}", e.getMessage());
        }
    }

    private static VulnFinding fromRow(ResultSet rs) throws SQLException {
        return new VulnFinding(
                rs.getString("id"),
                rs.getString("project_id"),
                rs.getString("rule_id"),
                rs.getString("cwe"),
                rs.getString("severity"),
                rs.getString("status"),
                rs.getString("unit_id"),
                rs.getString("qual_name"),
                rs.getString("file_path"),
                rs.getInt("start_line"),
                rs.getString("title"),
                rs.getString("detail"),
                rs.getString("found_at"));
    }
}
