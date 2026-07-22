package com.repograph.graph;

import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import com.repograph.core.graph.ProjectStats;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.neo4j.driver.Driver;
import org.neo4j.driver.Record;
import org.neo4j.driver.Result;
import org.neo4j.driver.Session;
import org.neo4j.driver.Value;
import org.neo4j.driver.Values;
import org.neo4j.driver.types.Node;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Neo4j 后端的图查询服务实现。
 *
 * <p>查询全部通过 Cypher 在数据库内完成，不再依赖应用端 BFS。变长深度通过
 * {@code [:CALLS*1..N]} 表达；返回结果将节点属性反序列化回 {@link CodeUnit}。
 *
 * @author leolu
 * @since 0.2.0
 */
@Service
public class CodeGraphQueryService implements GraphQueryService, GraphDiagnosticsService {

    /** CodeUnit 标准字段名集合，用于反序列化时区分顶层字段与扁平的 metadata 字段。 */
    private static final Set<String> STANDARD_FIELDS = Set.of(
            "id", "kind", "language", "qualifiedName", "simpleName",
            "filePath", "startLine", "endLine", "rawSource", "signature",
            "annotations", "parentQualifiedName", "projectId"
    );

    private final Driver driver;

    /**
     * 通过构造器注入 Neo4j {@link Driver}。
     *
     * @param driver Neo4j 驱动单例，不为 {@code null}
     */
    public CodeGraphQueryService(Driver driver) {
        this.driver = driver;
    }

    @Override
    public List<CodeUnit> findCallers(String qualifiedName, int depth, String projectId) {
        if (depth <= 0) return List.of();
        int safeDepth = Math.min(depth, 50);
        // 将类/接口目标展开为其包含的方法，使"查找某类的调用方"能返回调用该类任意方法的调用方。
        // 若目标为方法，CONTAINS 返回空，因此 methods=[] 而 targets=[target]。
        String cypher = String.format(Locale.ROOT, """
                MATCH (target:CodeUnit {qualifiedName: $qn})
                WHERE $pid = '' OR target.projectId = $pid
                OPTIONAL MATCH (target)-[:CONTAINS]->(m:CodeUnit)
                WITH target, collect(m) AS methods
                WITH methods + [target] AS targets
                UNWIND targets AS t
                MATCH (caller:CodeUnit)-[:CALLS*1..%d]->(t)
                WHERE $pid = '' OR caller.projectId = $pid
                RETURN DISTINCT caller AS unit
                """, safeDepth);
        return queryUnits(cypher, symbolParameters(qualifiedName, projectId));
    }

    @Override
    public List<CodeUnit> findCallees(String qualifiedName, int depth, String projectId) {
        if (depth <= 0) return List.of();
        int safeDepth = Math.min(depth, 50);
        // 将类/接口目标展开为其包含的方法。
        String cypher = String.format(Locale.ROOT, """
                MATCH (target:CodeUnit {qualifiedName: $qn})
                WHERE $pid = '' OR target.projectId = $pid
                OPTIONAL MATCH (target)-[:CONTAINS]->(m:CodeUnit)
                WITH target, collect(m) AS methods
                WITH methods + [target] AS starts
                UNWIND starts AS s
                MATCH (s)-[:CALLS*1..%d]->(callee:CodeUnit)
                WHERE $pid = '' OR callee.projectId = $pid
                RETURN DISTINCT callee AS unit
                """, safeDepth);
        return queryUnits(cypher, symbolParameters(qualifiedName, projectId));
    }

    @Override
    public Set<CodeUnit> impactAnalysis(String qualifiedName, String projectId) {
        // 将类/接口目标展开为其包含的方法，确保指向类内方法的 CALLS 边也被捕获。
        String cypher = """
                MATCH (target:CodeUnit {qualifiedName: $qn})
                WHERE $pid = '' OR target.projectId = $pid
                OPTIONAL MATCH (target)-[:CONTAINS]->(m:CodeUnit)
                WITH target, collect(m) AS methods
                WITH methods + [target] AS targets
                UNWIND targets AS t
                MATCH (dep:CodeUnit)-[:CALLS|DEFINES_TYPE|OVERRIDES|EXTENDS|IMPLEMENTS*]->(t)
                WHERE $pid = '' OR dep.projectId = $pid
                RETURN DISTINCT dep AS unit
                """;
        Set<CodeUnit> ordered = new LinkedHashSet<>(queryUnits(cypher,
                symbolParameters(qualifiedName, projectId)));
        return Collections.unmodifiableSet(ordered);
    }

    @Override
    public List<CodeUnit> findSubTypes(String qualifiedName, String projectId) {
        String cypher = """
                MATCH (parent:CodeUnit {qualifiedName: $qn})
                WHERE $pid = '' OR parent.projectId = $pid
                MATCH (sub:CodeUnit)-[:EXTENDS|IMPLEMENTS]->(parent)
                WHERE $pid = '' OR sub.projectId = $pid
                RETURN DISTINCT sub AS unit
                """;
        return queryUnits(cypher, symbolParameters(qualifiedName, projectId));
    }

    @Override
    public List<CodeUnit> findSymbols(String query, String projectId, int limit) {
        if (query == null || query.isBlank() || limit <= 0) return List.of();
        int safeLimit = Math.min(limit, 50);
        String cypher = """
                MATCH (n:CodeUnit)
                WHERE ($pid = '' OR n.projectId = $pid)
                  AND (toLower(n.qualifiedName) CONTAINS $query
                       OR toLower(n.simpleName) CONTAINS $query)
                WITH n,
                     CASE
                         WHEN toLower(n.qualifiedName) = $query THEN 0
                         WHEN toLower(n.qualifiedName) ENDS WITH $query THEN 1
                         WHEN toLower(n.qualifiedName) CONTAINS $query THEN 2
                         ELSE 3
                     END AS score
                ORDER BY score, size(n.qualifiedName), n.qualifiedName
                WITH n.qualifiedName AS qn, collect(n)[0] AS unit, min(score) AS score
                RETURN unit
                ORDER BY score, size(qn), qn
                LIMIT $limit
                """;
        return queryUnits(cypher, Values.parameters(
                "query", query.trim().toLowerCase(Locale.ROOT),
                "pid", normalizeProjectId(projectId),
                "limit", safeLimit));
    }

    @Override
    public Optional<CodeUnit> findSymbol(String qualifiedName, String projectId) {
        String cypher = """
                MATCH (n:CodeUnit {qualifiedName: $qn})
                WHERE $pid = '' OR n.projectId = $pid
                RETURN n AS unit
                ORDER BY n.filePath
                LIMIT 1
                """;
        return queryUnits(cypher, symbolParameters(qualifiedName, projectId)).stream().findFirst();
    }

    @Override
    public List<CodeUnit> findEntryPoints(String projectId) {
        boolean filterByProject = projectId != null && !projectId.isBlank();
        String cypher = filterByProject
                ? """
                  MATCH (n:CodeUnit)
                  WHERE n.is_entry_point = 'true' AND n.projectId = $pid
                  RETURN n AS unit
                  """
                : """
                  MATCH (n:CodeUnit)
                  WHERE n.is_entry_point = 'true'
                  RETURN n AS unit
                  """;
        return queryUnits(cypher,
                filterByProject ? Values.parameters("pid", projectId) : Values.parameters());
    }

    @Override
    public List<CodeUnit> listScanTargets(String projectId) {
        String cypher = """
                MATCH (u:CodeUnit)
                WHERE u.projectId = $pid
                  AND u.kind IN ['METHOD', 'CONSTRUCTOR', 'FUNCTION']
                  AND u.rawSource IS NOT NULL AND trim(u.rawSource) <> ''
                RETURN u AS unit
                """;
        return queryUnits(cypher, Values.parameters("pid", projectId));
    }

    @Override
    public List<CodeUnit> listSearchTargets(String projectId, String language, CodeUnitKind kind,
                                            boolean noTest, int limit) {
        if (limit <= 0) return List.of();
        int safeLimit = Math.min(limit, 10000);
        String cypher = """
                MATCH (u:CodeUnit)
                WHERE ($pid = '' OR u.projectId = $pid)
                  AND ($lang = '' OR u.language = $lang)
                  AND ($kind = '' OR u.kind = $kind)
                  AND ($noTest = false OR u.is_test IS NULL OR u.is_test <> 'true')
                  AND u.rawSource IS NOT NULL AND trim(u.rawSource) <> ''
                RETURN u AS unit
                ORDER BY u.filePath, u.startLine
                LIMIT $limit
                """;
        return queryUnits(cypher, Values.parameters(
                "pid", normalizeProjectId(projectId),
                "lang", language == null ? "" : language,
                "kind", kind == null ? "" : kind.name(),
                "noTest", noTest,
                "limit", safeLimit));
    }

    @Override
    public List<CodeUnit> findTestGaps(String projectId) {
        try (Session session = driver.session()) {
            // 阶段 1：收集从任意测试单元可达的 qualifiedName（深度 ≤ 6）
            String coveredQuery = """
                    MATCH (test:CodeUnit {projectId: $pid})
                    WHERE test.is_test = 'true'
                    OPTIONAL MATCH (test)-[:CALLS*0..6]->(reached:CodeUnit {projectId: $pid})
                    RETURN collect(DISTINCT coalesce(reached.qualifiedName, test.qualifiedName)) AS covered
                    """;
            Set<String> covered;
            Result covResult = session.run(coveredQuery, Values.parameters("pid", projectId));
            if (covResult.hasNext()) {
                covered = new java.util.HashSet<>(
                        covResult.next().get("covered").asList(v -> v.asString("")));
            } else {
                covered = Set.of();
            }

            // 阶段 2：所有未被覆盖集合包含的生产方法
            String prodQuery = """
                    MATCH (u:CodeUnit {projectId: $pid})
                    WHERE u.kind IN ['METHOD', 'CONSTRUCTOR', 'FUNCTION']
                      AND (u.is_test IS NULL OR u.is_test <> 'true')
                      AND u.rawSource IS NOT NULL AND trim(u.rawSource) <> ''
                    RETURN u AS unit
                    ORDER BY u.filePath, u.startLine
                    """;
            List<CodeUnit> all = queryUnits(prodQuery, Values.parameters("pid", projectId));
            final Set<String> coveredFinal = covered;
            return all.stream()
                    .filter(u -> !coveredFinal.contains(u.qualifiedName()))
                    .toList();
        }
    }

    @Override
    public List<CodeUnit> findDeadCode(String projectId) {
        String cypher = """
                MATCH (u:CodeUnit)
                WHERE u.projectId = $pid
                  AND u.kind IN ['METHOD', 'FUNCTION']
                  AND NOT (:CodeUnit)-[:CALLS]->(u)
                  AND (u.isEntryPoint IS NULL OR u.isEntryPoint = false)
                RETURN u AS unit
                ORDER BY u.filePath, u.startLine
                """;
        return queryUnits(cypher, Values.parameters("pid", projectId));
    }

    @Override
    public List<ClassEdge> findClassCallEdges(String projectId) {
        String cypher = """
                MATCH (u1:CodeUnit {projectId: $pid})-[:CALLS]->(u2:CodeUnit {projectId: $pid})
                WHERE u1.qualifiedName CONTAINS '#'
                  AND u2.qualifiedName CONTAINS '#'
                WITH split(u1.qualifiedName, '#')[0] AS callerClass,
                     split(u2.qualifiedName, '#')[0] AS calleeClass
                WHERE callerClass <> calleeClass
                RETURN DISTINCT callerClass, calleeClass
                """;
        try (Session session = driver.session()) {
            Result result = session.run(cypher, Values.parameters("pid", projectId));
            List<ClassEdge> edges = new ArrayList<>();
            while (result.hasNext()) {
                Record rec = result.next();
                edges.add(new ClassEdge(
                        rec.get("callerClass").asString(""),
                        rec.get("calleeClass").asString("")));
            }
            return Collections.unmodifiableList(edges);
        }
    }

    @Override
    public List<ProjectInfo> listProjects() {
        String cypher = """
                MATCH (p:Project)
                OPTIONAL MATCH (u:CodeUnit {projectId: p.id})
                WITH p, count(u) AS nodeCount
                RETURN p.id AS id, p.root AS root, nodeCount, p.indexedAt AS indexedAt
                ORDER BY id
                """;
        try (Session session = driver.session()) {
            Result result = session.run(cypher);
            List<ProjectInfo> out = new ArrayList<>();
            while (result.hasNext()) {
                Record rec = result.next();
                out.add(new ProjectInfo(
                        rec.get("id").asString(""),
                        rec.get("root").asString(""),
                        rec.get("nodeCount").asLong(0L),
                        rec.get("indexedAt").isNull() ? "" : rec.get("indexedAt").asObject().toString()
                ));
            }
            return Collections.unmodifiableList(out);
        }
    }

    @Override
    public ProjectStats projectStats(String projectId) {
        if (projectId == null || projectId.isBlank()) {
            return emptyStats(projectId);
        }
        try (Session session = driver.session()) {
            // 一次往返获取项目根目录和各项汇总数据。
            Record summary = session.run("""
                    OPTIONAL MATCH (p:Project {id: $pid})
                    WITH p
                    OPTIONAL MATCH (u:CodeUnit {projectId: $pid})
                    RETURN coalesce(p.root, '') AS root,
                           count(u) AS totalUnits,
                           count(DISTINCT u.filePath) AS totalFiles,
                           sum(CASE WHEN u.is_entry_point = 'true' THEN 1 ELSE 0 END) AS entryPoints,
                           sum(CASE WHEN u.is_test = 'true' THEN 1 ELSE 0 END) AS tests
                    """, Values.parameters("pid", projectId)).single();

            Map<String, Long> kinds = bucketCounts(session,
                    """
                    MATCH (u:CodeUnit {projectId: $pid})
                    RETURN u.kind AS key, count(*) AS c
                    ORDER BY c DESC
                    """, projectId);

            Map<String, Long> languages = bucketCounts(session,
                    """
                    MATCH (u:CodeUnit {projectId: $pid})
                    RETURN u.language AS key, count(*) AS c
                    ORDER BY c DESC
                    """, projectId);

            Map<String, Long> frameworks = bucketCounts(session,
                    """
                    MATCH (u:CodeUnit {projectId: $pid})
                    WHERE u.framework IS NOT NULL
                    RETURN u.framework AS key, count(*) AS c
                    ORDER BY c DESC
                    """, projectId);

            Map<String, Long> edgeKinds = bucketCounts(session,
                    """
                    MATCH (u:CodeUnit {projectId: $pid})-[r]->()
                    RETURN type(r) AS key, count(*) AS c
                    ORDER BY c DESC
                    """, projectId);

            long totalEdges = edgeKinds.values().stream().mapToLong(Long::longValue).sum();

            return new ProjectStats(
                    projectId,
                    summary.get("root").asString(""),
                    summary.get("totalUnits").asLong(0L),
                    summary.get("totalFiles").asLong(0L),
                    totalEdges,
                    summary.get("entryPoints").asLong(0L),
                    summary.get("tests").asLong(0L),
                    Collections.unmodifiableMap(kinds),
                    Collections.unmodifiableMap(languages),
                    Collections.unmodifiableMap(frameworks),
                    Collections.unmodifiableMap(edgeKinds)
            );
        }
    }

    /** 执行返回 (key, c) 元组的 Cypher，并按计数降序收集为 {@link LinkedHashMap}。 */
    private static Map<String, Long> bucketCounts(Session session, String cypher, String projectId) {
        Result result = session.run(cypher, Values.parameters("pid", projectId));
        Map<String, Long> out = new LinkedHashMap<>();
        while (result.hasNext()) {
            Record rec = result.next();
            String key = rec.get("key").isNull() ? "" : rec.get("key").asString();
            if (key.isEmpty()) continue;
            out.put(key, rec.get("c").asLong(0L));
        }
        return out;
    }

    /** projectId 为空或空白时返回的零值统计占位对象。 */
    private static ProjectStats emptyStats(String projectId) {
        return new ProjectStats(
                projectId == null ? "" : projectId,
                "", 0L, 0L, 0L, 0L, 0L,
                Map.of(), Map.of(), Map.of(), Map.of()
        );
    }

    /** 执行返回 unit 节点的 Cypher，并将每个 {@code unit} 节点反序列化为 CodeUnit。 */
    private List<CodeUnit> queryUnits(String cypher, Value parameters) {
        try (Session session = driver.session()) {
            Result result = session.run(cypher, parameters);
            List<CodeUnit> out = new ArrayList<>();
            while (result.hasNext()) {
                Record rec = result.next();
                CodeUnit u = toCodeUnit(rec.get("unit").asNode());
                if (u != null) out.add(u);
            }
            return Collections.unmodifiableList(out);
        }
    }

    /** 从 Neo4j 节点重建 CodeUnit；非标准属性作为 metadata 写入。 */
    private static CodeUnit toCodeUnit(Node node) {
        if (node == null) return null;
        Map<String, Object> props = node.asMap();

        String kindStr = stringOf(props.get("kind"));
        CodeUnitKind kind;
        try {
            kind = CodeUnitKind.valueOf(kindStr);
        } catch (IllegalArgumentException e) {
            return null;
        }

        Map<String, String> metadata = new HashMap<>();
        for (Map.Entry<String, Object> entry : props.entrySet()) {
            if (!STANDARD_FIELDS.contains(entry.getKey()) && entry.getValue() != null) {
                metadata.put(entry.getKey(), entry.getValue().toString());
            }
        }

        @SuppressWarnings("unchecked")
        List<String> annotations = (List<String>) props.getOrDefault("annotations", List.of());

        return new CodeUnit(
                stringOf(props.get("id")),
                kind,
                stringOf(props.get("language")),
                stringOf(props.get("qualifiedName")),
                stringOf(props.get("simpleName")),
                stringOf(props.get("filePath")),
                intOf(props.get("startLine")),
                intOf(props.get("endLine")),
                stringOf(props.get("rawSource")),
                stringOf(props.get("signature")),
                annotations,
                (String) props.get("parentQualifiedName"),
                Collections.unmodifiableMap(metadata)
        );
    }

    private static String stringOf(Object v) {
        return v == null ? "" : v.toString();
    }

    private static int intOf(Object v) {
        if (v instanceof Number n) return n.intValue();
        return 0;
    }

    private static Value symbolParameters(String qualifiedName, String projectId) {
        return Values.parameters("qn", qualifiedName, "pid", normalizeProjectId(projectId));
    }

    private static String normalizeProjectId(String projectId) {
        return projectId == null ? "" : projectId.trim();
    }
}
