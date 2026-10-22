package com.repograph.wiki;

import com.repograph.persistence.SqliteDatabasePath;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.time.Instant;
import java.util.Optional;

/**
 * 分层摘要生成阶段缓存（DeepMap 断点续跑语义的本仓库适配）。
 *
 * <p>按 (projectId, scopeId, phase, factsHash) 缓存已完成的生成产物；
 * 同一事实指纹下重启或重试时直接复用，不重复消耗模型调用。事实变化
 * （factsHash 不同）时自然失效，不主动清理旧行。
 *
 * @author leolu
 * @since 0.7.0
 */
@Service
public class SummaryGenerationCache {

    private static final Logger log = LoggerFactory.getLogger(SummaryGenerationCache.class);

    private final String dbPath;
    private final ObjectMapper objectMapper;

    public SummaryGenerationCache(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath,
            ObjectMapper objectMapper) {
        this.dbPath = SqliteDatabasePath.prepare(dbPath);
        this.objectMapper = objectMapper;
        initTable();
    }

    private void initTable() {
        try (Connection conn = connection();
             Statement st = conn.createStatement()) {
            st.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS summary_generation_cache (
                        project_id TEXT NOT NULL,
                        scope_id TEXT NOT NULL,
                        phase TEXT NOT NULL,
                        facts_hash TEXT NOT NULL,
                        payload_json TEXT NOT NULL,
                        completed_at TEXT NOT NULL,
                        PRIMARY KEY (project_id, scope_id, phase, facts_hash)
                    )
                    """);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to init summary generation cache", e);
        }
    }

    /**
     * 查询缓存命中。
     *
     * @param projectId 项目标识
     * @param scopeId   摘要范围标识
     * @param phase     阶段标识（如 {@code LLM_ARCH:项目概述}）
     * @param factsHash 事实指纹
     * @return 缓存的产物 JSON；未命中为空
     */
    public Optional<String> find(String projectId, String scopeId, String phase, String factsHash) {
        try (Connection conn = connection();
             PreparedStatement ps = conn.prepareStatement("""
                     SELECT payload_json FROM summary_generation_cache
                     WHERE project_id = ? AND scope_id = ? AND phase = ? AND facts_hash = ?
                     """)) {
            ps.setString(1, projectId);
            ps.setString(2, scopeId);
            ps.setString(3, phase);
            ps.setString(4, factsHash);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.ofNullable(rs.getString("payload_json")) : Optional.empty();
            }
        } catch (SQLException e) {
            log.warn("Summary cache lookup failed (treated as miss): {}", e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * 写入缓存（幂等覆盖同键旧值）。
     *
     * @param projectId   项目标识
     * @param scopeId     摘要范围标识
     * @param phase       阶段标识
     * @param factsHash   事实指纹
     * @param payloadJson 产物 JSON
     */
    public void save(String projectId, String scopeId, String phase,
                     String factsHash, String payloadJson) {
        try (Connection conn = connection();
             PreparedStatement ps = conn.prepareStatement("""
                     INSERT INTO summary_generation_cache
                         (project_id, scope_id, phase, facts_hash, payload_json, completed_at)
                     VALUES (?,?,?,?,?,?)
                     ON CONFLICT(project_id, scope_id, phase, facts_hash) DO UPDATE SET
                         payload_json = excluded.payload_json,
                         completed_at = excluded.completed_at
                     """)) {
            ps.setString(1, projectId);
            ps.setString(2, scopeId);
            ps.setString(3, phase);
            ps.setString(4, factsHash);
            ps.setString(5, payloadJson);
            ps.setString(6, Instant.now().toString());
            ps.executeUpdate();
        } catch (SQLException e) {
            // 缓存写失败不影响生成主流程，仅失去续跑能力
            log.warn("Summary cache save failed (ignored): {}", e.getMessage());
        }
    }

    private Connection connection() throws SQLException {
        return DriverManager.getConnection("jdbc:sqlite:" + dbPath);
    }
}
