package com.repograph.vector.store;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.util.CodeUnitIdUtil;
import com.repograph.core.vector.EmbeddedUnit;
import com.repograph.core.vector.SearchOptions;
import com.repograph.core.vector.SearchPage;
import com.repograph.vector.config.QdrantProperties;
import io.qdrant.client.QdrantClient;
import io.qdrant.client.QdrantGrpcClient;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * {@link QdrantVectorStore} 集成测试，连接本地真实 Qdrant 实例（{@code localhost:16333}）。
 *
 * <p>若 Qdrant 服务未启动，所有测试自动跳过（{@code assumeTrue} 失败），不计为错误。
 * 每个测试使用独立的集合 {@value #TEST_COLLECTION}，每次测试前后均清理，保证相互隔离。
 *
 * <p>运行前置条件：Qdrant 已在 {@code localhost:16333} 以 gRPC 模式运行。
 *
 * @author leolu
 * @since 0.1.0
 */
@Tag("integration")
class QdrantVectorStoreIT {

    private static final String TEST_COLLECTION = "code_units_test";
    private static final String PROJECT_ID      = "it-project";
    private static final int    VECTOR_SIZE     = 768;

    /**
     * VEC_A：第 0 维为 1，其余为 0（单位向量）。
     * 两向量余弦相似度 = 0，用于验证排名。
     */
    private static final float[] VEC_A = new float[VECTOR_SIZE];
    /** VEC_B：第 1 维为 1，其余为 0（与 VEC_A 正交）。 */
    private static final float[] VEC_B = new float[VECTOR_SIZE];

    static {
        VEC_A[0] = 1.0f;
        VEC_B[1] = 1.0f;
    }

    /** 用于生命周期管理（删除集合）的独立客户端，避免通过被测类执行 DDL。 */
    private static QdrantClient adminClient;

    private QdrantVectorStore store;

    // ── 生命周期 ───────────────────────────────────────────────────────────────

    @BeforeAll
    static void assumeQdrantAvailableAndCreateAdminClient() {
        // 用真实 gRPC 调用探测，而不是 TCP 端口检查：
        // 16333 可能只是 Qdrant REST 端口，gRPC 端口未暴露时需要跳过测试。
        QdrantClient probe = null;
        try {
            probe = new QdrantClient(
                    QdrantGrpcClient.newBuilder("localhost", 16333, false).build());
            probe.listCollectionsAsync().get(3, TimeUnit.SECONDS);
        } catch (Exception e) {
            assumeTrue(false,
                    "跳过 QdrantVectorStoreIT：Qdrant gRPC 不可达 localhost:16333 — "
                    + e.getMessage()
                    + "。请确保 Qdrant 以 gRPC 模式运行并暴露该端口（通常需要 -p 16333:6334）。");
        } finally {
            if (probe != null) {
                try { probe.close(); } catch (Exception ignored) {}
            }
        }
        adminClient = new QdrantClient(
                QdrantGrpcClient.newBuilder("localhost", 16333, false).build());
    }

    @AfterAll
    static void closeAdminClient() throws Exception {
        if (adminClient != null) {
            deleteTestCollectionIfExists();
            adminClient.close();
        }
    }

    @BeforeEach
    void createStoreAndEnsureCollection() {
        QdrantProperties props = new QdrantProperties("localhost", 16333, TEST_COLLECTION, VECTOR_SIZE);
        // 搜索时 embed 调用：任意查询均返回 VEC_A，用于验证相似度排名
        store = new QdrantVectorStore(props, inputs -> inputs.stream().map(s -> copyVec(VEC_A)).toList());
        store.ensureCollection();
    }

    @AfterEach
    void dropTestCollection() throws Exception {
        deleteTestCollectionIfExists();
    }

    private static void deleteTestCollectionIfExists() throws Exception {
        try {
            List<String> collections = adminClient.listCollectionsAsync().get(5, TimeUnit.SECONDS);
            if (collections.contains(TEST_COLLECTION)) {
                adminClient.deleteCollectionAsync(TEST_COLLECTION).get(10, TimeUnit.SECONDS);
            }
        } catch (Exception e) {
            // 清理失败不影响测试结果
        }
    }

    // ── 辅助工厂 ──────────────────────────────────────────────────────────────

    private static CodeUnit buildUnit(String qualifiedName, String filePath,
                                      int startLine, int endLine) {
        return new CodeUnit(
                CodeUnitIdUtil.computeId("test-proj", filePath, CodeUnitKind.METHOD, qualifiedName),
                CodeUnitKind.METHOD, "java",
                qualifiedName,
                qualifiedName.substring(qualifiedName.lastIndexOf('#') + 1),
                filePath, startLine, endLine,
                "void " + qualifiedName + "() {}",
                qualifiedName + "()",
                List.of(), null, Map.of()
        );
    }

    private static float[] copyVec(float[] src) {
        return Arrays.copyOf(src, src.length);
    }

    // ── 语义检索 ──────────────────────────────────────────────────────────────

    @Test
    void semanticSearch_afterUpsert_returnsMatchingUnit() {
        CodeUnit unit = buildUnit("com.example.Foo#run", "src/Foo.java", 1, 10);
        store.upsert(List.of(new EmbeddedUnit(unit, copyVec(VEC_A), copyVec(VEC_A))), PROJECT_ID);

        SearchPage page = store.semanticSearch("find run method", SearchOptions.defaults());

        assertThat(page.results()).hasSize(1);
        assertThat(page.results().get(0).unit().qualifiedName()).isEqualTo("com.example.Foo#run");
        assertThat(page.results().get(0).score()).isGreaterThan(0.99f);
    }

    @Test
    void semanticSearch_ranksByVectorSimilarity() {
        CodeUnit unitA = buildUnit("com.example.A#m", "src/A.java", 1, 5);
        CodeUnit unitB = buildUnit("com.example.B#m", "src/B.java", 1, 5);
        // unitA 存 VEC_A，unitB 存 VEC_B；查询向量为 VEC_A → unitA 排第一
        store.upsert(List.of(
                new EmbeddedUnit(unitA, copyVec(VEC_A), copyVec(VEC_A)),
                new EmbeddedUnit(unitB, copyVec(VEC_B), copyVec(VEC_B))
        ), PROJECT_ID);

        SearchPage page = store.semanticSearch("anything", new SearchOptions(2, 0, null, null, null, false, false));

        assertThat(page.results()).hasSize(2);
        assertThat(page.results().get(0).unit().qualifiedName()).isEqualTo("com.example.A#m");
        assertThat(page.results().get(0).score()).isGreaterThan(page.results().get(1).score());
    }

    @Test
    void semanticSearch_withProjectIdFilter_excludesOtherProjects() {
        CodeUnit unit = buildUnit("com.example.Foo#x", "src/Foo.java", 1, 5);
        store.upsert(List.of(new EmbeddedUnit(unit, copyVec(VEC_A), copyVec(VEC_A))), PROJECT_ID);

        SearchPage page = store.semanticSearch(
                "query", new SearchOptions(10, 0, null, null, "other-project", false, false));

        assertThat(page.results()).isEmpty();
    }

    @Test
    void semanticSearch_withKindFilter_excludesNonMatchingKind() {
        CodeUnit unit = buildUnit("com.example.Foo#y", "src/Foo.java", 1, 5);
        store.upsert(List.of(new EmbeddedUnit(unit, copyVec(VEC_A), copyVec(VEC_A))), PROJECT_ID);

        // unit 是 METHOD，按 CLASS 过滤应返回空
        SearchPage page = store.semanticSearch(
                "query", new SearchOptions(10, 0, null, CodeUnitKind.CLASS, null, false, false));

        assertThat(page.results()).isEmpty();
    }

    // ── 代码相似检索 ──────────────────────────────────────────────────────────

    @Test
    void codeSearch_afterUpsert_returnsMatchingUnit() {
        CodeUnit unit = buildUnit("com.example.Util#hash", "src/Util.java", 10, 20);
        store.upsert(List.of(new EmbeddedUnit(unit, copyVec(VEC_A), copyVec(VEC_A))), PROJECT_ID);

        SearchPage page = store.codeSearch("SHA256 hash code", SearchOptions.defaults());

        assertThat(page.results()).hasSize(1);
        assertThat(page.results().get(0).unit().qualifiedName()).isEqualTo("com.example.Util#hash");
    }

    // ── 符号精确查找 ──────────────────────────────────────────────────────────

    @Test
    void symbolLookup_knownQualifiedName_returnsUnit() {
        CodeUnit unit = buildUnit("com.example.Svc#login", "src/Svc.java", 5, 30);
        store.upsert(List.of(new EmbeddedUnit(unit, copyVec(VEC_A), copyVec(VEC_A))), PROJECT_ID);

        Optional<CodeUnit> found = store.symbolLookup("com.example.Svc#login");

        assertThat(found).isPresent();
        assertThat(found.get().qualifiedName()).isEqualTo("com.example.Svc#login");
        assertThat(found.get().startLine()).isEqualTo(5);
        assertThat(found.get().endLine()).isEqualTo(30);
    }

    @Test
    void symbolLookup_unknownQualifiedName_returnsEmpty() {
        Optional<CodeUnit> found = store.symbolLookup("com.example.Ghost#absent");

        assertThat(found).isEmpty();
    }

    // ── 位置定位 ──────────────────────────────────────────────────────────────

    @Test
    void locateByPosition_lineWithinRange_returnsUnit() {
        CodeUnit unit = buildUnit("com.example.Dao#save", "src/Dao.java", 10, 50);
        store.upsert(List.of(new EmbeddedUnit(unit, copyVec(VEC_A), copyVec(VEC_A))), PROJECT_ID);

        Optional<CodeUnit> found = store.locateByPosition("src/Dao.java", 30);

        assertThat(found).isPresent();
        assertThat(found.get().qualifiedName()).isEqualTo("com.example.Dao#save");
    }

    @Test
    void locateByPosition_lineOutsideRange_returnsEmpty() {
        CodeUnit unit = buildUnit("com.example.Dao#delete", "src/Dao.java", 10, 50);
        store.upsert(List.of(new EmbeddedUnit(unit, copyVec(VEC_A), copyVec(VEC_A))), PROJECT_ID);

        Optional<CodeUnit> found = store.locateByPosition("src/Dao.java", 99);

        assertThat(found).isEmpty();
    }

    @Test
    void locateByPosition_boundaryLines_returnsUnit() {
        CodeUnit unit = buildUnit("com.example.Repo#find", "src/Repo.java", 20, 40);
        store.upsert(List.of(new EmbeddedUnit(unit, copyVec(VEC_A), copyVec(VEC_A))), PROJECT_ID);

        assertThat(store.locateByPosition("src/Repo.java", 20)).isPresent();
        assertThat(store.locateByPosition("src/Repo.java", 40)).isPresent();
    }

    // ── 文件删除 ──────────────────────────────────────────────────────────────

    @Test
    void removeByFile_deletesPointsForFile_keepsOtherFiles() {
        CodeUnit unitFoo = buildUnit("com.example.Foo#go", "src/Foo.java", 1, 10);
        CodeUnit unitBar = buildUnit("com.example.Bar#go", "src/Bar.java", 1, 10);
        store.upsert(List.of(
                new EmbeddedUnit(unitFoo, copyVec(VEC_A), copyVec(VEC_A)),
                new EmbeddedUnit(unitBar, copyVec(VEC_B), copyVec(VEC_B))
        ), PROJECT_ID);

        store.removeByFile("src/Foo.java", PROJECT_ID);

        assertThat(store.symbolLookup("com.example.Foo#go")).isEmpty();
        assertThat(store.symbolLookup("com.example.Bar#go")).isPresent();
    }

    @Test
    void removeByFile_nonExistingFile_isIdempotent() {
        // 删除不存在的文件不抛异常
        store.removeByFile("src/NonExistent.java", PROJECT_ID);
    }
}
