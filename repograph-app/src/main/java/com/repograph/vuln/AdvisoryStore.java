package com.repograph.vuln;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Maven 依赖漏洞 Advisory 数据库，基于 SQLite 持久化。
 *
 * <p>启动时若 {@code advisories} 表为空，自动从 classpath {@code advisories/maven-bundled.json}
 * 加载内置 Advisory 数据。用户可通过 {@link #importAdvisories} 追加外部数据。
 *
 * <p>Advisory 唯一键为 {@code (id, groupId, artifactId)}，重复导入时跳过。
 *
 * @author leolu
 * @since 0.5.0
 */
@Service
public class AdvisoryStore {

    private static final Logger log = LoggerFactory.getLogger(AdvisoryStore.class);

    private final String dbPath;
    private final ObjectMapper objectMapper;

    public AdvisoryStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath,
            ObjectMapper objectMapper) {
        this.dbPath = dbPath;
        this.objectMapper = objectMapper;
        initTable();
        seedBundledAdvisories();
    }

    /**
     * Advisory 记录，对应 JSON 结构与 SQLite 行。
     *
     * @param id          CVE / GHSA ID
     * @param summary     简要描述
     * @param severity    CRITICAL / HIGH / MEDIUM / LOW
     * @param cwe         CWE 编号，如 CWE-502
     * @param groupId     Maven groupId
     * @param artifactId  Maven artifactId
     * @param introduced  影响起始版本（含），空表示所有早期版本
     * @param fixed       修复版本（不含），空表示尚无修复
     * @param source      来源：bundled / imported
     */
    public record Advisory(
            String id, String summary, String severity, String cwe,
            String groupId, String artifactId,
            String introduced, String fixed, String source) {}

    /** 批量导入 Advisory，以 {@code (id, groupId, artifactId)} 为唯一键，重复时跳过。 */
    public int importAdvisories(List<Advisory> advisories) {
        int inserted = 0;
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (PreparedStatement ps = conn.prepareStatement("""
                    INSERT OR IGNORE INTO advisories
                        (id, summary, severity, cwe, group_id, artifact_id, introduced, fixed, source)
                    VALUES (?,?,?,?,?,?,?,?,?)
                    """)) {
                for (Advisory a : advisories) {
                    ps.setString(1, a.id());
                    ps.setString(2, a.summary());
                    ps.setString(3, a.severity());
                    ps.setString(4, a.cwe() != null ? a.cwe() : "");
                    ps.setString(5, a.groupId());
                    ps.setString(6, a.artifactId());
                    ps.setString(7, a.introduced() != null ? a.introduced() : "");
                    ps.setString(8, a.fixed() != null ? a.fixed() : "");
                    ps.setString(9, a.source() != null ? a.source() : "imported");
                    ps.addBatch();
                }
                int[] counts = ps.executeBatch();
                for (int c : counts) if (c > 0) inserted++;
            }
            conn.commit();
        } catch (SQLException e) {
            log.warn("Failed to import advisories: {}", e.getMessage());
        }
        return inserted;
    }

    /**
     * 查找指定 Maven 坐标的所有匹配 Advisory（不做版本过滤，由调用方比对）。
     *
     * @param groupId    Maven groupId
     * @param artifactId Maven artifactId
     * @return 匹配的 Advisory 列表
     */
    public List<Advisory> findByCoordinate(String groupId, String artifactId) {
        List<Advisory> result = new ArrayList<>();
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT * FROM advisories WHERE group_id = ? AND artifact_id = ?")) {
            ps.setString(1, groupId);
            ps.setString(2, artifactId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) result.add(fromRow(rs));
            }
        } catch (SQLException e) {
            log.warn("Advisory lookup failed for {}:{}: {}", groupId, artifactId, e.getMessage());
        }
        return result;
    }

    /** 返回全部 Advisory，供管理界面展示。 */
    public List<Advisory> listAll() {
        List<Advisory> result = new ArrayList<>();
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(
                     "SELECT * FROM advisories ORDER BY severity, id")) {
            while (rs.next()) result.add(fromRow(rs));
        } catch (SQLException e) {
            log.warn("Failed to list advisories: {}", e.getMessage());
        }
        return result;
    }

    // ── 内部方法 ──────────────────────────────────────────────────────────────

    private void initTable() {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement()) {
            stmt.execute("""
                    CREATE TABLE IF NOT EXISTS advisories (
                        id          TEXT NOT NULL,
                        summary     TEXT NOT NULL,
                        severity    TEXT NOT NULL,
                        cwe         TEXT,
                        group_id    TEXT NOT NULL,
                        artifact_id TEXT NOT NULL,
                        introduced  TEXT,
                        fixed       TEXT,
                        source      TEXT NOT NULL DEFAULT 'bundled',
                        PRIMARY KEY (id, group_id, artifact_id)
                    )
                    """);
        } catch (SQLException e) {
            log.warn("Failed to init advisories table: {}", e.getMessage());
        }
    }

    private void seedBundledAdvisories() {
        // 仅在表为空时才播种内置数据
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SELECT COUNT(*) AS c FROM advisories")) {
            if (rs.next() && rs.getLong("c") > 0) return;
        } catch (SQLException e) {
            log.warn("Failed to check advisory count: {}", e.getMessage());
            return;
        }

        try (InputStream in = new ClassPathResource("advisories/maven-bundled.json").getInputStream()) {
            List<Map<String, String>> raw = objectMapper.readValue(in, new TypeReference<>() {});
            List<Advisory> bundled = raw.stream()
                    .map(m -> new Advisory(
                            m.getOrDefault("id", ""),
                            m.getOrDefault("summary", ""),
                            m.getOrDefault("severity", "HIGH"),
                            m.getOrDefault("cwe", ""),
                            m.getOrDefault("groupId", ""),
                            m.getOrDefault("artifactId", ""),
                            m.getOrDefault("introduced", ""),
                            m.getOrDefault("fixed", ""),
                            "bundled"))
                    .filter(a -> !a.groupId().isBlank() && !a.artifactId().isBlank())
                    .toList();
            int count = importAdvisories(bundled);
            log.info("Seeded {} bundled Maven advisories", count);
        } catch (IOException e) {
            log.warn("Failed to seed bundled advisories: {}", e.getMessage());
        }
    }

    private static Advisory fromRow(ResultSet rs) throws SQLException {
        return new Advisory(
                rs.getString("id"),
                rs.getString("summary"),
                rs.getString("severity"),
                rs.getString("cwe"),
                rs.getString("group_id"),
                rs.getString("artifact_id"),
                rs.getString("introduced"),
                rs.getString("fixed"),
                rs.getString("source"));
    }
}
