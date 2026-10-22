package com.repograph.wiki;

import com.repograph.persistence.SqliteDatabasePath;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.wiki.SummaryDocument;
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
import java.util.UUID;

/**
 * 分层摘要文档的 SQLite 存储。同一 (projectId, scopeId) 每次生成追加一行，
 * docVersion 递增，旧版本保留可回看；JSON 列保存完整 {@link SummaryDocument}。
 *
 * <p>连接模式与 RuleEvaluationStore 一致：每次操作独立连接，构造时幂等建表。
 *
 * @author leolu
 * @since 0.7.0
 */
@Service
public class SummaryStore {

    private static final Logger log = LoggerFactory.getLogger(SummaryStore.class);

    private final String dbPath;
    private final ObjectMapper objectMapper;

    public SummaryStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath,
            ObjectMapper objectMapper) {
        this.dbPath = SqliteDatabasePath.prepare(dbPath);
        this.objectMapper = objectMapper;
        initTable();
    }

    private void initTable() {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             Statement st = conn.createStatement()) {
            st.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS summaries (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        scope_id TEXT NOT NULL,
                        level TEXT NOT NULL,
                        doc_version INTEGER NOT NULL,
                        title TEXT NOT NULL,
                        document_json TEXT NOT NULL,
                        generated_at TEXT NOT NULL
                    )
                    """);
            st.executeUpdate("""
                    CREATE INDEX IF NOT EXISTS idx_summaries_project_scope
                        ON summaries(project_id, scope_id, doc_version DESC)
                    """);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to init summaries table", e);
        }
    }

    /**
     * 持久化一份摘要文档，若 id 为空则自动分配 UUID。
     *
     * @param document 摘要文档
     * @return 持久化后的文档（分配 id 后）
     */
    public SummaryDocument save(SummaryDocument document) {
        String id = document.id() == null || document.id().isEmpty()
                ? UUID.randomUUID().toString() : document.id();
        SummaryDocument stored = new SummaryDocument(
                id, document.projectId(), document.level(), document.scopeId(),
                document.title(), document.sections(), document.citations(),
                document.docVersion(), document.generatedAt(), document.status(),
                document.model(), document.missingInfo());
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("""
                     INSERT INTO summaries
                         (id, project_id, scope_id, level, doc_version, title, document_json, generated_at)
                     VALUES (?,?,?,?,?,?,?,?)
                     """)) {
            ps.setString(1, stored.id());
            ps.setString(2, stored.projectId());
            ps.setString(3, stored.scopeId());
            ps.setString(4, stored.level().name());
            ps.setInt(5, stored.docVersion());
            ps.setString(6, stored.title());
            ps.setString(7, objectMapper.writeValueAsString(stored));
            ps.setString(8, stored.generatedAt());
            ps.executeUpdate();
            return stored;
        } catch (Exception e) {
            throw new IllegalStateException("Failed to save summary document", e);
        }
    }

    /**
     * 查询同一 (projectId, scopeId) 的下一个 docVersion。
     *
     * @param projectId 项目标识
     * @param scopeId   摘要范围标识
     * @return 当前最大版本 + 1；无历史时为 1
     */
    public int nextDocVersion(String projectId, String scopeId) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("""
                     SELECT COALESCE(MAX(doc_version), 0) + 1 AS next_version
                     FROM summaries WHERE project_id = ? AND scope_id = ?
                     """)) {
            ps.setString(1, projectId);
            ps.setString(2, scopeId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt("next_version") : 1;
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to query next doc version", e);
        }
    }

    /**
     * 列出项目所有范围的最新版本摘要（每个 scopeId 取 docVersion 最大的一行）。
     *
     * @param projectId 项目标识
     * @return 摘要文档列表，PROJECT 级在前，其余按 scopeId 字典序
     */
    public List<SummaryDocument> listLatest(String projectId) {
        String url = "jdbc:sqlite:" + dbPath;
        List<SummaryDocument> result = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("""
                     SELECT s.document_json FROM summaries s
                     JOIN (
                         SELECT scope_id, MAX(doc_version) AS max_version
                         FROM summaries WHERE project_id = ?
                         GROUP BY scope_id
                     ) latest
                       ON s.scope_id = latest.scope_id AND s.doc_version = latest.max_version
                     WHERE s.project_id = ?
                     ORDER BY CASE WHEN s.level = 'PROJECT' THEN 0 ELSE 1 END, s.scope_id ASC
                     """)) {
            ps.setString(1, projectId);
            ps.setString(2, projectId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    result.add(objectMapper.readValue(rs.getString("document_json"),
                            SummaryDocument.class));
                }
            }
            return result;
        } catch (Exception e) {
            log.warn("Corrupted summary row skipped in listLatest: {}", e.getMessage());
            return result;
        }
    }

    /**
     * 按 id 查找摘要文档。
     *
     * @param id 文档 id
     * @return 命中的文档
     */
    public Optional<SummaryDocument> findById(String id) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT document_json FROM summaries WHERE id = ?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(objectMapper.readValue(rs.getString("document_json"),
                            SummaryDocument.class));
                }
                return Optional.empty();
            }
        } catch (Exception e) {
            throw new IllegalStateException("Failed to find summary by id: " + id, e);
        }
    }
}
