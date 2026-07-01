package com.repograph.graph;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.model.RelationEdge;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.neo4j.driver.Result;
import org.neo4j.driver.Session;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link CodeGraph} 写入路径测试，运行在 Neo4j Test Harness 内嵌实例上。
 *
 * @author leolu
 * @since 0.2.0
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CodeGraphTest {

    private final Neo4jTestFixture fixture = new Neo4jTestFixture();
    private CodeGraph graph;

    @BeforeAll
    void startNeo4j() {
        fixture.start();
        graph = new CodeGraph(fixture.driver());
    }

    @AfterAll
    void stopNeo4j() {
        fixture.stop();
    }

    @BeforeEach
    void wipe() {
        fixture.wipe();
    }

    private static CodeUnit unit(String id, String qn, String file) {
        return new CodeUnit(id, CodeUnitKind.METHOD, "java", qn, qn, file,
                1, 10, "", qn, List.of(), null, Map.of());
    }

    private static CodeUnit entryPoint(String id, String qn, String file) {
        return new CodeUnit(id, CodeUnitKind.METHOD, "java", qn, qn, file,
                1, 10, "", qn, List.of(), null, Map.of("is_entry_point", "true"));
    }

    private long countNodes() {
        try (Session s = fixture.driver().session()) {
            return s.run("MATCH (n:CodeUnit) RETURN count(n) AS c").single().get("c").asLong();
        }
    }

    private long countEdges(EdgeKind kind) {
        try (Session s = fixture.driver().session()) {
            Result r = s.run("MATCH ()-[r:" + kind.name() + "]->() RETURN count(r) AS c");
            return r.single().get("c").asLong();
        }
    }

    @Test
    void addUnits_persistsCoreProperties() {
        graph.addUnits(List.of(unit("id1", "com.example.Foo#bar", "Foo.java")), "proj-aaa");

        try (Session s = fixture.driver().session()) {
            Map<String, Object> node = s.run(
                    "MATCH (n:CodeUnit {id: 'id1'}) RETURN n").single().get("n").asNode().asMap();
            assertThat(node.get("qualifiedName")).isEqualTo("com.example.Foo#bar");
            assertThat(node.get("filePath")).isEqualTo("Foo.java");
            assertThat(node.get("kind")).isEqualTo("METHOD");
            assertThat(node.get("projectId")).isEqualTo("proj-aaa");
        }
    }

    @Test
    void addUnits_splatsMetadataAsFlatProperties() {
        graph.addUnits(List.of(entryPoint("id1", "Ctrl#get", "Ctrl.java")), "proj-aaa");

        try (Session s = fixture.driver().session()) {
            Object val = s.run("MATCH (n:CodeUnit {id: 'id1'}) RETURN n.is_entry_point AS v")
                    .single().get("v").asObject();
            assertThat(val).isEqualTo("true");
        }
    }

    @Test
    void addEdges_createsTypedRelationship() {
        graph.addUnits(List.of(
                unit("a", "A#m", "A.java"),
                unit("b", "B#m", "B.java")), "proj");
        graph.addEdges(List.of(new RelationEdge("a", "b", EdgeKind.CALLS, true, "A.java", 5)));

        assertThat(countEdges(EdgeKind.CALLS)).isEqualTo(1);
    }

    @Test
    void addEdges_resolvesQnTargetWhenIdMissing() {
        graph.addUnits(List.of(
                unit("a", "A#m", "A.java"),
                unit("b", "B#m", "B.java")), "proj");
        // edge stores targetId as QN, not as hash id — must be resolved by Cypher
        graph.addEdges(List.of(new RelationEdge("a", "B#m", EdgeKind.CALLS, false, "A.java", 5)));

        assertThat(countEdges(EdgeKind.CALLS)).isEqualTo(1);
    }

    @Test
    void addEdges_resolvesUniqueCrossFileMethodPrefixWithinSourceProject() {
        graph.addUnits(List.of(
                unit("source", "Client#run()", "Client.java"),
                unit("target", "Service#save(String)", "Service.java")), "proj-a");
        graph.addUnits(List.of(
                unit("other", "Service#save(String)", "Service.java")), "proj-b");

        graph.addEdges(List.of(
                new RelationEdge("source", "Service#save", EdgeKind.CALLS, false, "Client.java", 5)));

        try (Session session = fixture.driver().session()) {
            Map<String, Object> target = session.run("""
                    MATCH (:CodeUnit {id: 'source'})-[:CALLS]->(target)
                    RETURN target
                    """).single().get("target").asNode().asMap();
            assertThat(target.get("id")).isEqualTo("target");
        }
    }

    @Test
    void addEdges_resolvesCrossFileOverloadByArgumentCount() {
        graph.addUnits(List.of(
                unit("source", "Client#run()", "Client.java"),
                unit("zero", "Service#save()", "Service.java"),
                unit("one", "Service#save(String)", "Service.java")), "proj");

        graph.addEdges(List.of(new RelationEdge(
                "source", "Service#save::arity=1", EdgeKind.CALLS, false, "Client.java", 5)));

        try (Session session = fixture.driver().session()) {
            String targetId = session.run("""
                    MATCH (:CodeUnit {id: 'source'})-[:CALLS]->(target)
                    RETURN target.id AS id
                    """).single().get("id").asString();
            assertThat(targetId).isEqualTo("one");
        }
    }

    @Test
    void addEdges_resolvesCrossFileOverloadByExactArgumentTypes() {
        graph.addUnits(List.of(
                unit("source", "Client#run()", "Client.java"),
                unit("string", "Service#save(String)", "Service.java"),
                unit("number", "Service#save(int)", "Service.java")), "proj");

        graph.addEdges(List.of(new RelationEdge(
                "source", "Service#save(String)", EdgeKind.CALLS, false, "Client.java", 5)));

        try (Session session = fixture.driver().session()) {
            String targetId = session.run("""
                    MATCH (:CodeUnit {id: 'source'})-[:CALLS]->(target)
                    RETURN target.id AS id
                    """).single().get("id").asString();
            assertThat(targetId).isEqualTo("string");
        }
    }

    @Test
    void addEdges_sameArityOverloadsRemainUnresolved() {
        graph.addUnits(List.of(
                unit("source", "Client#run()", "Client.java"),
                unit("string", "Service#save(String)", "Service.java"),
                unit("number", "Service#save(int)", "Service.java")), "proj");

        graph.addEdges(List.of(new RelationEdge(
                "source", "Service#save::arity=1", EdgeKind.CALLS, false, "Client.java", 5)));

        assertThat(countEdges(EdgeKind.CALLS)).isZero();
    }

    @Test
    void addEdges_dropsEdgesWithUnresolvableTargets() {
        graph.addUnits(List.of(unit("a", "A#m", "A.java")), "proj");
        // target ID/QN does not exist — edge silently dropped
        graph.addEdges(List.of(new RelationEdge("a", "External#api", EdgeKind.CALLS, false, "A.java", 5)));

        assertThat(countEdges(EdgeKind.CALLS)).isZero();
    }

    @Test
    void addEdges_groupsByEdgeKind() {
        graph.addUnits(List.of(
                unit("a", "A#m", "A.java"),
                unit("b", "B#m", "B.java"),
                unit("i", "IFace", "IFace.java")), "proj");
        graph.addEdges(List.of(
                new RelationEdge("a", "b", EdgeKind.CALLS, true, "A.java", 5),
                new RelationEdge("a", "i", EdgeKind.IMPLEMENTS, true, "A.java", 1)));

        assertThat(countEdges(EdgeKind.CALLS)).isEqualTo(1);
        assertThat(countEdges(EdgeKind.IMPLEMENTS)).isEqualTo(1);
    }

    @Test
    void removeByFile_detachDeletesAllNodesAndEdges() {
        graph.addUnits(List.of(
                unit("a", "A#m", "A.java"),
                unit("b", "B#m", "B.java")), "proj");
        graph.addEdges(List.of(new RelationEdge("a", "b", EdgeKind.CALLS, true, "A.java", 5)));

        graph.removeByFile("A.java", "proj");

        assertThat(countNodes()).isEqualTo(1); // only B remains
        assertThat(countEdges(EdgeKind.CALLS)).isZero();
    }

    @Test
    void removeByFile_projectId_doesNotDeleteSamePathFromAnotherProject() {
        graph.addUnits(List.of(unit("a", "A#m", "src/A.java")), "proj-a");
        graph.addUnits(List.of(unit("b", "B#m", "src/A.java")), "proj-b");

        graph.removeByFile("src/A.java", "proj-a");

        try (Session session = fixture.driver().session()) {
            List<String> ids = session.run("MATCH (n:CodeUnit) RETURN n.id AS id")
                    .list(record -> record.get("id").asString());
            assertThat(ids).containsExactly("b");
        }
    }

    @Test
    void findFilePaths_returnsDistinctPathsForProject() {
        graph.addUnits(List.of(
                unit("a1", "A#one", "src/A.java"),
                unit("a2", "A#two", "src/A.java"),
                unit("b", "B#one", "src/B.java")), "proj-a");
        graph.addUnits(List.of(unit("c", "C#one", "src/C.java")), "proj-b");

        assertThat(graph.findFilePaths("proj-a"))
                .containsExactlyInAnyOrder("src/A.java", "src/B.java");
    }

    @Test
    void addUnits_emptyList_isNoOp() {
        graph.addUnits(List.of(), "proj");
        assertThat(countNodes()).isZero();
    }

    @Test
    void addEdges_emptyList_isNoOp() {
        graph.addEdges(List.of());
        assertThat(countEdges(EdgeKind.CALLS)).isZero();
    }
}
