package com.repograph.graph;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.model.RelationEdge;
import org.neo4j.driver.Driver;
import org.neo4j.driver.Session;
import org.neo4j.driver.Values;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Neo4j 后端的代码知识图谱写入门面。
 *
 * <p>持久化模型：节点统一打标签 {@code :CodeUnit}，标准字段为顶层属性，{@code metadata}
 * 中的键以扁平形式写入节点（如 {@code is_entry_point: "true"}）。边关系类型直接使用
 * {@link EdgeKind} 名称（{@code :CALLS}、{@code :EXTENDS} 等）。
 *
 * <p>所有写入都走单条 {@code UNWIND}-batch Cypher，避免逐节点/逐边的网络往返。
 *
 * @author leolu
 * @since 0.2.0
 */
@Component
public class CodeGraph {

    private static final Logger log = LoggerFactory.getLogger(CodeGraph.class);

    private final Driver driver;

    /**
     * 通过构造器注入 Neo4j {@link Driver}。
     *
     * @param driver Neo4j 驱动单例，不为 {@code null}
     */
    public CodeGraph(Driver driver) {
        this.driver = driver;
    }

    /**
     * 批量写入代码单元，按 {@code id} 进行 {@code MERGE}（已存在则更新属性），并标注
     * 所属 {@code projectId} 以支持后续按项目过滤的查询。
     *
     * @param units     待写入的代码单元列表，可为空（无操作）
     * @param projectId 项目 ID（12 字符前缀），写入节点的 {@code projectId} 属性
     */
    public void addUnits(List<CodeUnit> units, String projectId) {
        if (units == null || units.isEmpty()) return;
        List<Map<String, Object>> rows = new ArrayList<>(units.size());
        for (CodeUnit u : units) {
            rows.add(toRow(u));
        }
        String cypher = """
                UNWIND $rows AS row
                MERGE (n:CodeUnit {id: row.id})
                SET n.kind = row.kind,
                    n.language = row.language,
                    n.qualifiedName = row.qualifiedName,
                    n.simpleName = row.simpleName,
                    n.filePath = row.filePath,
                    n.startLine = row.startLine,
                    n.endLine = row.endLine,
                    n.rawSource = row.rawSource,
                    n.signature = row.signature,
                    n.annotations = row.annotations,
                    n.parentQualifiedName = row.parentQualifiedName,
                    n.projectId = $projectId
                WITH n, row
                SET n += row.metadata
                """;
        try (Session session = driver.session()) {
            session.executeWrite(tx -> tx.run(cypher,
                    Values.parameters("rows", rows, "projectId", projectId)).consume());
        }
    }

    /**
     * 批量写入关系边，按 {@link EdgeKind} 分组，每组一次 Cypher。
     *
     * <p>未解析（{@code resolved=false}）的边会尝试用 {@code targetId} 当作 QN 查节点；
     * 找不到则该边静默丢弃（保持与旧实现"外部库调用不入图"的语义一致）。
     *
     * @param edges 待写入的边列表，可为空
     */
    public void addEdges(List<RelationEdge> edges) {
        if (edges == null || edges.isEmpty()) return;
        Map<EdgeKind, List<Map<String, Object>>> byKind = new EnumMap<>(EdgeKind.class);
        for (RelationEdge e : edges) {
            TargetReference target = TargetReference.parse(e.targetId());
            Map<String, Object> row = new HashMap<>();
            row.put("sid", e.sourceId());
            row.put("tid", e.targetId());
            row.put("targetBase", target.baseQualifiedName());
            row.put("arity", target.arity());
            row.put("resolved", e.resolved());
            row.put("fp", e.filePath() == null ? "" : e.filePath());
            row.put("sl", e.sourceLine());
            byKind.computeIfAbsent(e.kind(), k -> new ArrayList<>()).add(row);
        }
        try (Session session = driver.session()) {
            for (Map.Entry<EdgeKind, List<Map<String, Object>>> entry : byKind.entrySet()) {
                String relType = entry.getKey().name(); // 枚举名，无注入风险
                String cypher = String.format(Locale.ROOT, """
                        UNWIND $rows AS row
                        MATCH (s:CodeUnit {id: row.sid})
                        OPTIONAL MATCH (candidate:CodeUnit)
                        WHERE candidate.projectId = s.projectId
                          AND (candidate.id = row.tid
                               OR candidate.qualifiedName = row.tid
                               OR (candidate.qualifiedName STARTS WITH row.targetBase + '('
                                   AND CASE
                                       WHEN row.arity < 0 THEN true
                                       WHEN split(split(candidate.qualifiedName, '(')[1], ')')[0] = ''
                                           THEN row.arity = 0
                                       ELSE size(split(
                                           split(split(candidate.qualifiedName, '(')[1], ')')[0], ','
                                       )) = row.arity
                                   END))
                        WITH s, row, collect(DISTINCT candidate) AS candidates
                        WITH s, row,
                             COALESCE(
                                 head([c IN candidates WHERE c.id = row.tid]),
                                 head([c IN candidates WHERE c.qualifiedName = row.tid]),
                                 CASE
                                     WHEN size([c IN candidates
                                                WHERE c.qualifiedName STARTS WITH row.targetBase + '(']) = 1
                                     THEN head([c IN candidates
                                                WHERE c.qualifiedName STARTS WITH row.targetBase + '('])
                                 END
                             ) AS target
                        WHERE target IS NOT NULL
                        MERGE (s)-[r:%s]->(target)
                        SET r.filePath = row.fp,
                            r.sourceLine = row.sl,
                            r.resolved = true
                        """, relType);
                session.executeWrite(tx -> tx.run(cypher,
                        Values.parameters("rows", entry.getValue())).consume());
            }
        }
    }

    /**
     * 注册或更新项目元节点 {@code (:Project)}，记录 projectId、根目录和最近索引时间。
     *
     * <p>调用方通常在索引开始时调用一次，用于支持 {@code listProjects()} 查询。
     * 节点按 {@code id} MERGE，多次调用是幂等的。
     *
     * @param projectId   12 字符 projectId 前缀，不为 {@code null}
     * @param projectRoot 项目根目录绝对路径，不为 {@code null}
     */
    public void recordProject(String projectId, String projectRoot) {
        if (projectId == null || projectId.isBlank()) return;
        String cypher = """
                MERGE (p:Project {id: $id})
                SET p.root = $root, p.indexedAt = datetime()
                """;
        try (Session session = driver.session()) {
            session.executeWrite(tx -> tx.run(cypher,
                    Values.parameters("id", projectId, "root", projectRoot)).consume());
        }
    }

    /**
     * 删除指定项目的所有图数据（{@code :CodeUnit} + 关联边 + {@code :Project} 元节点）。
     *
     * <p>用于项目级清理（{@code DELETE /api/v1/index/project}）。{@code DETACH DELETE}
     * 自动处理所有入边和出边。projectId 为空时无操作。
     *
     * @param projectId 项目 ID，不为 {@code null}
     */
    public void removeByProject(String projectId) {
        if (projectId == null || projectId.isBlank()) return;
        try (Session session = driver.session()) {
            int unitDeleted = session.executeWrite(tx -> tx.run(
                    "MATCH (n:CodeUnit {projectId: $pid}) DETACH DELETE n",
                    Values.parameters("pid", projectId)
            ).consume().counters().nodesDeleted());
            int metaDeleted = session.executeWrite(tx -> tx.run(
                    "MATCH (p:Project {id: $pid}) DETACH DELETE p",
                    Values.parameters("pid", projectId)
            ).consume().counters().nodesDeleted());
            log.info("Removed project '{}': {} units + {} meta node(s)",
                    projectId, unitDeleted, metaDeleted);
        }
    }

    /**
     * 删除指定文件下的所有节点（连带所有关联边），用于增量重新索引时的清理。
     *
     * @param filePath  文件相对路径，不为 {@code null}
     * @param projectId 所属项目 ID，不为 {@code null}
     */
    public void removeByFile(String filePath, String projectId) {
        if (filePath == null || filePath.isBlank() || projectId == null || projectId.isBlank()) return;
        String cypher = "MATCH (n:CodeUnit {filePath: $fp, projectId: $pid}) DETACH DELETE n";
        try (Session session = driver.session()) {
            int deleted = session.executeWrite(tx ->
                    tx.run(cypher, Values.parameters("fp", filePath, "pid", projectId)).consume()
                            .counters().nodesDeleted());
            log.debug("Removed {} nodes from graph for file '{}' in project '{}'",
                    deleted, filePath, projectId);
        }
    }

    /**
     * 返回指定项目当前图中记录的全部源文件路径。
     *
     * @param projectId 项目 ID
     * @return 去重后的文件相对路径集合
     */
    public Set<String> findFilePaths(String projectId) {
        if (projectId == null || projectId.isBlank()) return Set.of();
        String cypher = """
                MATCH (n:CodeUnit {projectId: $pid})
                WHERE n.filePath IS NOT NULL AND n.filePath <> ''
                RETURN DISTINCT n.filePath AS filePath
                ORDER BY filePath
                """;
        try (Session session = driver.session()) {
            Set<String> paths = new LinkedHashSet<>();
            session.run(cypher, Values.parameters("pid", projectId))
                    .forEachRemaining(record -> paths.add(record.get("filePath").asString()));
            return Set.copyOf(paths);
        }
    }

    /** 将 CodeUnit 转换为 Neo4j 参数行，metadata 以子 Map 形式展开写入。 */
    private static Map<String, Object> toRow(CodeUnit u) {
        Map<String, Object> row = new HashMap<>();
        row.put("id", u.id());
        row.put("kind", u.kind().name());
        row.put("language", nullToEmpty(u.language()));
        row.put("qualifiedName", nullToEmpty(u.qualifiedName()));
        row.put("simpleName", nullToEmpty(u.simpleName()));
        row.put("filePath", nullToEmpty(u.filePath()));
        row.put("startLine", u.startLine());
        row.put("endLine", u.endLine());
        row.put("rawSource", nullToEmpty(u.rawSource()));
        row.put("signature", nullToEmpty(u.signature()));
        row.put("annotations", u.annotations() != null ? u.annotations() : List.of());
        row.put("parentQualifiedName", u.parentQualifiedName()); // 可为 null
        row.put("metadata", u.metadata() != null ? u.metadata() : Map.of());
        return row;
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    private record TargetReference(String baseQualifiedName, int arity) {

        private static final String ARITY_MARKER = "::arity=";

        private static TargetReference parse(String targetId) {
            if (targetId == null) return new TargetReference("", -1);
            int marker = targetId.lastIndexOf(ARITY_MARKER);
            if (marker < 0) return new TargetReference(targetId, -1);
            try {
                int arity = Integer.parseInt(targetId.substring(marker + ARITY_MARKER.length()));
                return new TargetReference(targetId.substring(0, marker), arity);
            } catch (NumberFormatException e) {
                return new TargetReference(targetId, -1);
            }
        }
    }
}
