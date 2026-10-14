package com.repograph.finding;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.RuleEvaluationReport;
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
 * 规则效果评估快照的 SQLite 存储：每次评估持久化一份完整 {@link RuleEvaluationReport}，
 * 用于版本间回归对比与历史查询。快照按生成时间倒序排列，重启不丢失。
 *
 * @author leolu
 */
@Service
public class RuleEvaluationStore {

    private static final Logger log = LoggerFactory.getLogger(RuleEvaluationStore.class);

    private final String dbPath;
    private final ObjectMapper objectMapper;

    /**
     * 创建评估快照存储并幂等初始化表结构。
     *
     * @param dbPath       SQLite 数据库文件路径
     * @param objectMapper Jackson 映射器，用于报告 JSON 序列化
     */
    public RuleEvaluationStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath,
            ObjectMapper objectMapper) {
        this.dbPath = dbPath;
        this.objectMapper = objectMapper;
        initTable();
    }

    /**
     * 持久化一份评估快照，自动分配快照 ID。
     *
     * @param report 评估报告
     * @throws IllegalStateException 数据库写入失败
     */
    public void save(RuleEvaluationReport report) {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("""
                     INSERT INTO rule_evaluations
                         (id, project_id, rule_id, version, report_json, generated_at)
                     VALUES (?,?,?,?,?,?)
                     """)) {
            ps.setString(1, UUID.randomUUID().toString());
            ps.setString(2, report.projectId());
            ps.setString(3, report.ruleId());
            ps.setInt(4, report.version());
            ps.setString(5, objectMapper.writeValueAsString(report));
            ps.setString(6, report.generatedAt());
            ps.executeUpdate();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to save rule evaluation snapshot", e);
        }
    }

    /**
     * 按项目与规则列出全部评估快照，生成时间倒序（最新在前）。
     *
     * @param projectId 项目标识
     * @param ruleId    规则标识
     * @return 快照报告列表
     */
    public List<RuleEvaluationReport> list(String projectId, String ruleId) {
        String url = "jdbc:sqlite:" + dbPath;
        List<RuleEvaluationReport> result = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("""
                     SELECT report_json FROM rule_evaluations
                     WHERE project_id = ? AND rule_id = ?
                     ORDER BY generated_at DESC, rowid DESC
                     """)) {
            ps.setString(1, projectId);
            ps.setString(2, ruleId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    result.add(objectMapper.readValue(rs.getString("report_json"),
                            RuleEvaluationReport.class));
                }
            }
            return result;
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to list rule evaluations", e);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("Failed to deserialize rule evaluation snapshot", e);
        }
    }

    /**
     * 查询最近一份评估快照，用于下一次评估的回归基线。
     *
     * @param projectId 项目标识
     * @param ruleId    规则标识
     * @return 最近快照，不存在时为空
     */
    public Optional<RuleEvaluationReport> latest(String projectId, String ruleId) {
        List<RuleEvaluationReport> all = list(projectId, ruleId);
        return all.isEmpty() ? Optional.empty() : Optional.of(all.get(0));
    }

    private void initTable() {
        String url = "jdbc:sqlite:" + dbPath;
        try (Connection conn = DriverManager.getConnection(url);
             Statement statement = conn.createStatement()) {
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS rule_evaluations (
                        id           TEXT PRIMARY KEY,
                        project_id   TEXT NOT NULL,
                        rule_id      TEXT NOT NULL,
                        version      INTEGER NOT NULL,
                        report_json  TEXT NOT NULL,
                        generated_at TEXT NOT NULL
                    )
                    """);
            statement.execute("""
                    CREATE INDEX IF NOT EXISTS idx_rule_evaluations_lookup
                    ON rule_evaluations(project_id, rule_id, generated_at)
                    """);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to initialize rule evaluation tables", e);
        }
    }
}
