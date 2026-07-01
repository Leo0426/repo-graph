package com.repograph.vector.store;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.vector.EmbeddedUnit;
import com.repograph.core.vector.EmbeddingService;
import com.repograph.core.vector.SearchOptions;
import com.repograph.core.vector.SearchPage;
import com.repograph.core.vector.SearchResult;
import com.repograph.vector.config.QdrantProperties;
import com.google.common.util.concurrent.Futures;
import io.qdrant.client.QdrantClient;
import io.qdrant.client.grpc.JsonWithInt;
import io.qdrant.client.grpc.Points.Filter;
import io.qdrant.client.grpc.Points.RetrievedPoint;
import io.qdrant.client.grpc.Points.ScrollResponse;
import io.qdrant.client.grpc.Points.ScoredPoint;
import io.qdrant.client.grpc.Points.UpdateResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link QdrantVectorStore} 单元测试，使用 Mock 客户端验证 payload 构建、filter 构建和序列化逻辑。
 *
 * <p>不连接真实 Qdrant 实例；集成测试见 {@link QdrantVectorStoreIT}。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class QdrantVectorStoreTest {

    private static final int VECTOR_SIZE = 4;

    @Mock
    QdrantClient client;
    @Mock
    EmbeddingService embeddingService;

    private QdrantVectorStore store;

    @BeforeEach
    void setUp() {
        QdrantProperties props = new QdrantProperties("localhost", 6334, "test_coll", VECTOR_SIZE);
        store = new QdrantVectorStore(props, embeddingService, client);
    }

    // ── Payload helpers ────────────────────────────────────────────────────────

    private static JsonWithInt.Value strValue(String s) {
        return JsonWithInt.Value.newBuilder().setStringValue(s).build();
    }

    private static JsonWithInt.Value intValue(long v) {
        return JsonWithInt.Value.newBuilder().setIntegerValue(v).build();
    }

    /** 构建一个完整的 Qdrant payload Map，供 payloadToCodeUnit 反序列化。 */
    private static Map<String, JsonWithInt.Value> fullPayload(String qualifiedName,
                                                               String kind) {
        Map<String, JsonWithInt.Value> m = new HashMap<>();
        m.put("id",             strValue("abc123"));
        m.put("kind",           strValue(kind));
        m.put("language",       strValue("java"));
        m.put("qualified_name", strValue(qualifiedName));
        m.put("simple_name",    strValue("bar"));
        m.put("file_path",      strValue("src/Foo.java"));
        m.put("start_line",     intValue(5));
        m.put("end_line",       intValue(20));
        m.put("raw_source",     strValue("void bar(){}"));
        m.put("signature",      strValue("void bar()"));
        m.put("annotations",    strValue("[]"));
        return m;
    }

    /** 构建用于 upsert 测试的 CodeUnit，id 长度满足 toUuid 前 32 字符要求。 */
    private static CodeUnit sampleUnit(String qualifiedName) {
        return new CodeUnit(
                "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
                CodeUnitKind.METHOD, "java",
                qualifiedName, "bar", "src/Foo.java", 5, 20,
                "void bar(){}", "void bar()", List.of(), null, Map.of());
    }

    private static final float[] VEC = {0.1f, 0.2f, 0.3f, 0.4f};

    // ── upsert ─────────────────────────────────────────────────────────────────

    @Test
    void upsert_emptyList_neverCallsClient() {
        store.upsert(List.of(), "proj");

        verify(client, never()).upsertAsync(anyString(), anyList());
    }

    @Test
    void upsert_withUnits_callsUpsertAsync() {
        when(client.upsertAsync(anyString(), anyList()))
                .thenReturn(Futures.immediateFuture(UpdateResult.getDefaultInstance()));

        store.upsert(List.of(new EmbeddedUnit(sampleUnit("com.example.Foo#bar"), VEC, VEC)), "proj");

        verify(client).upsertAsync(anyString(), anyList());
    }

    // ── semanticSearch / codeSearch ────────────────────────────────────────────

    @Test
    void semanticSearch_embedsQueryAndDelegatesToSearchAsync() {
        when(embeddingService.embed(List.of("find services"))).thenReturn(List.of(VEC));
        when(client.searchAsync(any()))
                .thenReturn(Futures.immediateFuture(List.of()));

        SearchPage page = store.semanticSearch("find services", SearchOptions.defaults());

        assertThat(page.results()).isEmpty();
        verify(embeddingService).embed(List.of("find services"));
        verify(client).searchAsync(any());
    }

    @Test
    void codeSearch_embedsSnippetAndDelegatesToSearchAsync() {
        when(embeddingService.embed(List.of("void foo(){}"))).thenReturn(List.of(VEC));
        when(client.searchAsync(any()))
                .thenReturn(Futures.immediateFuture(List.of()));

        store.codeSearch("void foo(){}", SearchOptions.defaults());

        verify(embeddingService).embed(List.of("void foo(){}"));
        verify(client).searchAsync(any());
    }

    @Test
    void semanticSearch_deserializesPayloadIntoSearchResult() {
        when(embeddingService.embed(any())).thenReturn(List.of(VEC));

        ScoredPoint scored = ScoredPoint.newBuilder()
                .setScore(0.9f)
                .putAllPayload(fullPayload("com.example.Foo#bar", "METHOD"))
                .build();
        when(client.searchAsync(any()))
                .thenReturn(Futures.immediateFuture(List.of(scored)));

        SearchPage page = store.semanticSearch("query", SearchOptions.defaults());

        assertThat(page.results()).hasSize(1);
        assertThat(page.results().get(0).score()).isEqualTo(0.9f);
        assertThat(page.results().get(0).unit().qualifiedName()).isEqualTo("com.example.Foo#bar");
        assertThat(page.results().get(0).unit().kind()).isEqualTo(CodeUnitKind.METHOD);
        assertThat(page.results().get(0).unit().startLine()).isEqualTo(5);
        assertThat(page.results().get(0).unit().filePath()).isEqualTo("src/Foo.java");
    }

    // ── symbolLookup ───────────────────────────────────────────────────────────

    @Test
    void symbolLookup_notFound_returnsEmpty() {
        when(client.scrollAsync(any()))
                .thenReturn(Futures.immediateFuture(ScrollResponse.getDefaultInstance()));

        Optional<CodeUnit> result = store.symbolLookup("com.example.Ghost#absent");

        assertThat(result).isEmpty();
        verify(client).scrollAsync(any());
    }

    @Test
    void symbolLookup_found_returnsDeserializedUnit() {
        RetrievedPoint point = RetrievedPoint.newBuilder()
                .putAllPayload(fullPayload("com.example.Svc#login", "METHOD"))
                .build();
        ScrollResponse response = ScrollResponse.newBuilder().addResult(point).build();
        when(client.scrollAsync(any())).thenReturn(Futures.immediateFuture(response));

        Optional<CodeUnit> result = store.symbolLookup("com.example.Svc#login");

        assertThat(result).isPresent();
        assertThat(result.get().qualifiedName()).isEqualTo("com.example.Svc#login");
        assertThat(result.get().startLine()).isEqualTo(5);
        assertThat(result.get().endLine()).isEqualTo(20);
    }

    // ── locateByPosition ───────────────────────────────────────────────────────

    @Test
    void locateByPosition_notFound_returnsEmpty() {
        when(client.scrollAsync(any()))
                .thenReturn(Futures.immediateFuture(ScrollResponse.getDefaultInstance()));

        Optional<CodeUnit> result = store.locateByPosition("src/Foo.java", 99);

        assertThat(result).isEmpty();
    }

    @Test
    void locateByPosition_found_returnsDeserializedUnit() {
        RetrievedPoint point = RetrievedPoint.newBuilder()
                .putAllPayload(fullPayload("com.example.Foo#bar", "METHOD"))
                .build();
        ScrollResponse response = ScrollResponse.newBuilder().addResult(point).build();
        when(client.scrollAsync(any())).thenReturn(Futures.immediateFuture(response));

        Optional<CodeUnit> result = store.locateByPosition("src/Foo.java", 10);

        assertThat(result).isPresent();
        assertThat(result.get().qualifiedName()).isEqualTo("com.example.Foo#bar");
    }

    // ── removeByFile ───────────────────────────────────────────────────────────

    @Test
    void removeByFile_callsDeleteAsync() {
        when(client.deleteAsync(anyString(), any(Filter.class)))
                .thenReturn(Futures.immediateFuture(UpdateResult.getDefaultInstance()));

        store.removeByFile("src/Foo.java", "proj");

        verify(client).deleteAsync(anyString(), any(Filter.class));
    }

    // ── isHealthy ──────────────────────────────────────────────────────────────

    @Test
    void isHealthy_whenClientResponds_returnsTrue() {
        when(client.listCollectionsAsync())
                .thenReturn(Futures.immediateFuture(List.of()));

        assertThat(store.isHealthy()).isTrue();
    }

    @Test
    void isHealthy_whenClientThrows_returnsFalse() {
        when(client.listCollectionsAsync())
                .thenReturn(Futures.immediateFailedFuture(new RuntimeException("refused")));

        assertThat(store.isHealthy()).isFalse();
    }
}
