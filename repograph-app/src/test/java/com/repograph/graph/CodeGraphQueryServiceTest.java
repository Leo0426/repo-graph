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

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link CodeGraphQueryService} 查询路径测试，运行在 Neo4j Test Harness 内嵌实例上。
 *
 * @author leolu
 * @since 0.2.0
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CodeGraphQueryServiceTest {

    private final Neo4jTestFixture fixture = new Neo4jTestFixture();
    private CodeGraph graph;
    private CodeGraphQueryService query;

    @BeforeAll
    void startNeo4j() {
        fixture.start();
        graph = new CodeGraph(fixture.driver());
        query = new CodeGraphQueryService(fixture.driver());
    }

    @AfterAll
    void stopNeo4j() {
        fixture.stop();
    }

    @BeforeEach
    void wipe() {
        fixture.wipe();
    }

    private static CodeUnit method(String id, String qn, String file) {
        return new CodeUnit(id, CodeUnitKind.METHOD, "java", qn, qn, file,
                1, 10, "", qn, List.of(), null, Map.of());
    }

    private static CodeUnit clazz(String id, String qn) {
        return new CodeUnit(id, CodeUnitKind.CLASS, "java", qn, qn, qn + ".java",
                1, 20, "", qn, List.of(), null, Map.of());
    }

    private static CodeUnit entryPoint(String id, String qn) {
        return new CodeUnit(id, CodeUnitKind.METHOD, "java", qn, qn, qn + ".java",
                1, 5, "", qn, List.of(), null, Map.of("is_entry_point", "true"));
    }

    private static RelationEdge edge(String src, String tgt, EdgeKind kind) {
        return new RelationEdge(src, tgt, kind, true, "file.java", 1);
    }

    // ── findCallers ───────────────────────────────────────────────────────────

    @Test
    void findCallers_returnsDirectCallers() {
        graph.addUnits(List.of(
                method("target", "Foo#bar", "Foo.java"),
                method("caller", "Baz#call", "Baz.java")), "proj");
        graph.addEdges(List.of(edge("caller", "target", EdgeKind.CALLS)));

        List<CodeUnit> callers = query.findCallers("Foo#bar", 1);
        assertThat(callers).extracting(CodeUnit::qualifiedName).containsExactly("Baz#call");
    }

    @Test
    void findCallers_depth1_excludesTransitive() {
        graph.addUnits(List.of(
                method("a", "A#m", "A.java"),
                method("b", "B#m", "B.java"),
                method("c", "C#m", "C.java")), "proj");
        graph.addEdges(List.of(
                edge("a", "b", EdgeKind.CALLS),
                edge("b", "c", EdgeKind.CALLS)));

        // A→B→C: callers of C with depth=1 are only {B}
        List<CodeUnit> callers = query.findCallers("C#m", 1);
        assertThat(callers).extracting(CodeUnit::qualifiedName).containsExactly("B#m");
    }

    @Test
    void findCallers_depth2_includesTwoLevels() {
        graph.addUnits(List.of(
                method("a", "A#m", "A.java"),
                method("b", "B#m", "B.java"),
                method("c", "C#m", "C.java")), "proj");
        graph.addEdges(List.of(
                edge("a", "b", EdgeKind.CALLS),
                edge("b", "c", EdgeKind.CALLS)));

        List<CodeUnit> callers = query.findCallers("C#m", 2);
        assertThat(callers).extracting(CodeUnit::qualifiedName)
                .containsExactlyInAnyOrder("A#m", "B#m");
    }

    @Test
    void findCallers_nonExistentTarget_returnsEmpty() {
        assertThat(query.findCallers("NonExistent#m", 3)).isEmpty();
    }

    @Test
    void findCallers_depthZero_returnsEmpty() {
        graph.addUnits(List.of(method("a", "A#m", "A.java")), "proj");
        assertThat(query.findCallers("A#m", 0)).isEmpty();
    }

    @Test
    void findCallers_classTarget_returnsCallersOfContainedMethods() {
        graph.addUnits(List.of(
                clazz("cls", "com.example.Foo"),
                method("m1", "com.example.Foo#bar", "Foo.java"),
                method("ext", "Other#run", "Other.java")), "proj");
        graph.addEdges(List.of(
                edge("cls", "m1", EdgeKind.CONTAINS),
                edge("ext", "m1", EdgeKind.CALLS)));

        List<CodeUnit> callers = query.findCallers("com.example.Foo", 1);
        assertThat(callers).extracting(CodeUnit::qualifiedName).containsExactly("Other#run");
    }

    @Test
    void findCallers_projectId_isolatesSameQualifiedNameAcrossProjects() {
        graph.addUnits(List.of(
                method("target-a", "Foo#bar()", "Foo.java"),
                method("caller-a", "A#call()", "A.java")), "proj-a");
        graph.addUnits(List.of(
                method("target-b", "Foo#bar()", "Foo.java"),
                method("caller-b", "B#call()", "B.java")), "proj-b");
        graph.addEdges(List.of(
                edge("caller-a", "target-a", EdgeKind.CALLS),
                edge("caller-b", "target-b", EdgeKind.CALLS)));

        assertThat(query.findCallers("Foo#bar()", 1, "proj-a"))
                .extracting(CodeUnit::qualifiedName).containsExactly("A#call()");
    }

    @Test
    void findSymbols_partialQuery_returnsRankedProjectCandidates() {
        graph.addUnits(List.of(
                method("a1", "com.example.UserService#save(User)", "UserService.java"),
                method("a2", "com.example.UserService#saveAll(List)", "UserService.java"),
                method("a3", "com.example.Other#save(User)", "Other.java")), "proj-a");
        graph.addUnits(List.of(
                method("b1", "com.example.UserService#save(User)", "UserService.java")), "proj-b");

        assertThat(query.findSymbols("UserService#save", "proj-a", 10))
                .extracting(CodeUnit::qualifiedName)
                .containsExactly(
                        "com.example.UserService#save(User)",
                        "com.example.UserService#saveAll(List)");
    }

    @Test
    void findSymbol_exactQuery_isolatesProject() {
        graph.addUnits(List.of(method("a", "Foo#run()", "A/Foo.java")), "proj-a");
        graph.addUnits(List.of(method("b", "Foo#run()", "B/Foo.java")), "proj-b");

        assertThat(query.findSymbol("Foo#run()", "proj-b"))
                .get()
                .extracting(CodeUnit::id)
                .isEqualTo("b");
    }

    // ── findCallees ───────────────────────────────────────────────────────────

    @Test
    void findCallees_returnsDirectCallees() {
        graph.addUnits(List.of(
                method("caller", "A#run", "A.java"),
                method("calleeA", "B#doX", "B.java"),
                method("calleeB", "C#doY", "C.java")), "proj");
        graph.addEdges(List.of(
                edge("caller", "calleeA", EdgeKind.CALLS),
                edge("caller", "calleeB", EdgeKind.CALLS)));

        List<CodeUnit> callees = query.findCallees("A#run", 1);
        assertThat(callees).extracting(CodeUnit::qualifiedName)
                .containsExactlyInAnyOrder("B#doX", "C#doY");
    }

    @Test
    void findCallees_depthTwo_includesTransitive() {
        graph.addUnits(List.of(
                method("a", "A#main", "A.java"),
                method("b", "B#step", "B.java"),
                method("c", "C#done", "C.java")), "proj");
        graph.addEdges(List.of(
                edge("a", "b", EdgeKind.CALLS),
                edge("b", "c", EdgeKind.CALLS)));

        assertThat(query.findCallees("A#main", 2)).hasSize(2);
        assertThat(query.findCallees("A#main", 1)).hasSize(1);
    }

    @Test
    void findCallees_noOutgoingCalls_returnsEmpty() {
        graph.addUnits(List.of(method("leaf", "A#leaf", "A.java")), "proj");
        assertThat(query.findCallees("A#leaf", 1)).isEmpty();
    }

    @Test
    void findCallees_classTarget_returnsCalleesOfContainedMethods() {
        graph.addUnits(List.of(
                clazz("cls", "com.example.Svc"),
                method("m1", "com.example.Svc#execute", "Svc.java"),
                method("dep", "Repo#save", "Repo.java")), "proj");
        graph.addEdges(List.of(
                edge("cls", "m1", EdgeKind.CONTAINS),
                edge("m1", "dep", EdgeKind.CALLS)));

        List<CodeUnit> callees = query.findCallees("com.example.Svc", 1);
        assertThat(callees).extracting(CodeUnit::qualifiedName).containsExactly("Repo#save");
    }

    @Test
    void findCallees_projectId_isolatesSameQualifiedNameAcrossProjects() {
        graph.addUnits(List.of(
                method("start-a", "Foo#run()", "Foo.java"),
                method("end-a", "A#done()", "A.java")), "proj-a");
        graph.addUnits(List.of(
                method("start-b", "Foo#run()", "Foo.java"),
                method("end-b", "B#done()", "B.java")), "proj-b");
        graph.addEdges(List.of(
                edge("start-a", "end-a", EdgeKind.CALLS),
                edge("start-b", "end-b", EdgeKind.CALLS)));

        assertThat(query.findCallees("Foo#run()", 1, "proj-b"))
                .extracting(CodeUnit::qualifiedName).containsExactly("B#done()");
    }

    // ── impactAnalysis ────────────────────────────────────────────────────────

    @Test
    void impactAnalysis_includesCallersAndSubtypes() {
        graph.addUnits(List.of(
                clazz("svc", "IService"),
                clazz("impl", "ServiceImpl"),
                method("user", "Client#use", "Client.java")), "proj");
        graph.addEdges(List.of(
                edge("impl", "svc", EdgeKind.IMPLEMENTS),
                edge("user", "svc", EdgeKind.CALLS)));

        Set<CodeUnit> impacted = query.impactAnalysis("IService");
        assertThat(impacted).extracting(CodeUnit::qualifiedName)
                .containsExactlyInAnyOrder("ServiceImpl", "Client#use");
    }

    @Test
    void impactAnalysis_nonExistent_returnsEmpty() {
        assertThat(query.impactAnalysis("Nope")).isEmpty();
    }

    @Test
    void impactAnalysis_classTarget_includesCallersOfContainedMethods() {
        graph.addUnits(List.of(
                clazz("ctrl", "com.example.IndexController"),
                method("m1", "com.example.IndexController#index", "IndexController.java"),
                method("caller", "Client#invoke", "Client.java")), "proj");
        graph.addEdges(List.of(
                edge("ctrl", "m1", EdgeKind.CONTAINS),
                edge("caller", "m1", EdgeKind.CALLS)));

        Set<CodeUnit> impacted = query.impactAnalysis("com.example.IndexController");
        assertThat(impacted).extracting(CodeUnit::qualifiedName).containsExactly("Client#invoke");
    }

    // ── findSubTypes ──────────────────────────────────────────────────────────

    @Test
    void findSubTypes_returnsImplementsAndExtends() {
        graph.addUnits(List.of(
                clazz("iface", "IService"),
                clazz("impl", "ServiceImpl"),
                clazz("base", "BaseClass"),
                clazz("child", "ChildClass")), "proj");
        graph.addEdges(List.of(
                edge("impl", "iface", EdgeKind.IMPLEMENTS),
                edge("child", "base", EdgeKind.EXTENDS)));

        assertThat(query.findSubTypes("IService"))
                .extracting(CodeUnit::qualifiedName).containsExactly("ServiceImpl");
        assertThat(query.findSubTypes("BaseClass"))
                .extracting(CodeUnit::qualifiedName).containsExactly("ChildClass");
    }

    @Test
    void findSubTypes_leaf_returnsEmpty() {
        graph.addUnits(List.of(clazz("leaf", "LeafClass")), "proj");
        assertThat(query.findSubTypes("LeafClass")).isEmpty();
    }

    // ── findEntryPoints ───────────────────────────────────────────────────────

    @Test
    void findEntryPoints_returnsOnlyEntryPointUnits() {
        graph.addUnits(List.of(
                entryPoint("ep", "Ctrl#get"),
                method("regular", "Svc#compute", "Svc.java")), "proj");

        List<CodeUnit> eps = query.findEntryPoints("proj");
        assertThat(eps).extracting(CodeUnit::qualifiedName).containsExactly("Ctrl#get");
    }

    @Test
    void findEntryPoints_projectIdFilter_isolatesAcrossProjects() {
        graph.addUnits(List.of(entryPoint("epA", "A#get")), "proj-aaa");
        graph.addUnits(List.of(entryPoint("epB", "B#post")), "proj-bbb");

        assertThat(query.findEntryPoints("proj-aaa"))
                .extracting(CodeUnit::qualifiedName).containsExactly("A#get");
        assertThat(query.findEntryPoints("proj-bbb"))
                .extracting(CodeUnit::qualifiedName).containsExactly("B#post");
    }

    @Test
    void findEntryPoints_blankProjectId_returnsAllProjects() {
        graph.addUnits(List.of(entryPoint("epA", "A#get")), "proj-aaa");
        graph.addUnits(List.of(entryPoint("epB", "B#post")), "proj-bbb");

        assertThat(query.findEntryPoints("")).hasSize(2);
        assertThat(query.findEntryPoints(null)).hasSize(2);
    }

    @Test
    void findEntryPoints_noMatches_returnsEmpty() {
        graph.addUnits(List.of(method("m", "Svc#go", "Svc.java")), "proj");
        assertThat(query.findEntryPoints("proj")).isEmpty();
    }

    // ── listProjects ──────────────────────────────────────────────────────────

    @Test
    void listProjects_returnsRegisteredProjectsSorted() {
        graph.recordProject("bbb-111", "/Users/leo/projB");
        graph.recordProject("aaa-222", "/Users/leo/projA");
        graph.addUnits(List.of(method("a", "A#m", "A.java")), "aaa-222");
        graph.addUnits(List.of(
                method("b1", "B#one", "B.java"),
                method("b2", "B#two", "B.java")), "bbb-111");

        var projects = query.listProjects();
        assertThat(projects).hasSize(2);
        assertThat(projects.get(0).projectId()).isEqualTo("aaa-222");
        assertThat(projects.get(0).projectRoot()).isEqualTo("/Users/leo/projA");
        assertThat(projects.get(0).nodeCount()).isEqualTo(1);
        assertThat(projects.get(1).projectId()).isEqualTo("bbb-111");
        assertThat(projects.get(1).nodeCount()).isEqualTo(2);
    }

    @Test
    void listProjects_emptyGraph_returnsEmpty() {
        assertThat(query.listProjects()).isEmpty();
    }

    @Test
    void recordProject_isIdempotent() {
        graph.recordProject("aaa-222", "/old/path");
        graph.recordProject("aaa-222", "/new/path");

        var projects = query.listProjects();
        assertThat(projects).hasSize(1);
        assertThat(projects.get(0).projectRoot()).isEqualTo("/new/path");
    }

    // ── projectStats ──────────────────────────────────────────────────────────

    @Test
    void projectStats_aggregatesCountsAcrossKindLanguageAndFramework() {
        graph.recordProject("proj-aaa", "/Users/leo/projA");
        graph.addUnits(List.of(
                clazz("c1", "ServiceA"),
                clazz("c2", "ServiceB"),
                method("m1", "ServiceA#do", "ServiceA.java"),
                method("m2", "ServiceB#run", "ServiceB.java"),
                new CodeUnit("ep1", CodeUnitKind.METHOD, "java", "Ctrl#get", "get",
                        "Ctrl.java", 1, 5, "", "Ctrl#get", List.of(), null,
                        Map.of("is_entry_point", "true", "framework", "spring")),
                new CodeUnit("t1", CodeUnitKind.METHOD, "java", "ServiceATest#it", "it",
                        "ServiceATest.java", 1, 5, "", "ServiceATest#it", List.of(), null,
                        Map.of("is_test", "true"))
        ), "proj-aaa");
        graph.addEdges(List.of(
                edge("m1", "m2", EdgeKind.CALLS),
                edge("ep1", "m1", EdgeKind.CALLS),
                edge("c2", "c1", EdgeKind.EXTENDS)
        ));

        var stats = query.projectStats("proj-aaa");
        assertThat(stats.projectId()).isEqualTo("proj-aaa");
        assertThat(stats.projectRoot()).isEqualTo("/Users/leo/projA");
        assertThat(stats.totalUnits()).isEqualTo(6);
        assertThat(stats.totalFiles()).isEqualTo(4);  // ServiceA.java, ServiceB.java, Ctrl.java, ServiceATest.java
        assertThat(stats.totalEdges()).isEqualTo(3);
        assertThat(stats.entryPointCount()).isEqualTo(1);
        assertThat(stats.testCount()).isEqualTo(1);
        assertThat(stats.kindDistribution())
                .containsEntry("METHOD", 4L)
                .containsEntry("CLASS", 2L);
        assertThat(stats.languageDistribution()).containsEntry("java", 6L);
        assertThat(stats.frameworkDistribution()).containsEntry("spring", 1L);
        assertThat(stats.edgeKindDistribution())
                .containsEntry("CALLS", 2L)
                .containsEntry("EXTENDS", 1L);
    }

    @Test
    void projectStats_isolatesAcrossProjects() {
        graph.recordProject("proj-aaa", "/projA");
        graph.recordProject("proj-bbb", "/projB");
        graph.addUnits(List.of(method("a1", "A#m", "A.java")), "proj-aaa");
        graph.addUnits(List.of(
                method("b1", "B#m", "B.java"),
                method("b2", "B#n", "B.java")), "proj-bbb");

        assertThat(query.projectStats("proj-aaa").totalUnits()).isEqualTo(1);
        assertThat(query.projectStats("proj-bbb").totalUnits()).isEqualTo(2);
    }

    @Test
    void projectStats_unknownProject_returnsZeroCounts() {
        var stats = query.projectStats("nonexistent");
        assertThat(stats.projectId()).isEqualTo("nonexistent");
        assertThat(stats.projectRoot()).isEmpty();
        assertThat(stats.totalUnits()).isZero();
        assertThat(stats.totalEdges()).isZero();
        assertThat(stats.kindDistribution()).isEmpty();
        assertThat(stats.languageDistribution()).isEmpty();
        assertThat(stats.frameworkDistribution()).isEmpty();
        assertThat(stats.edgeKindDistribution()).isEmpty();
    }

    @Test
    void projectStats_blankProjectId_returnsZeroCounts() {
        assertThat(query.projectStats(null).totalUnits()).isZero();
        assertThat(query.projectStats("").totalUnits()).isZero();
        assertThat(query.projectStats("   ").totalUnits()).isZero();
    }
}
