package com.repograph.vector.store;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.vector.EmbeddedUnit;
import com.repograph.core.vector.EmbeddingService;
import com.repograph.core.vector.SearchOptions;
import com.repograph.core.vector.SearchPage;
import com.repograph.core.vector.SearchResult;
import com.repograph.core.vector.VectorStore;
import com.repograph.vector.config.QdrantProperties;
import io.qdrant.client.ConditionFactory;
import io.qdrant.client.PointIdFactory;
import io.qdrant.client.QdrantClient;
import io.qdrant.client.QdrantGrpcClient;
import io.qdrant.client.ValueFactory;
import io.qdrant.client.VectorFactory;
import io.qdrant.client.VectorsFactory;
import io.qdrant.client.WithPayloadSelectorFactory;
import io.qdrant.client.grpc.Collections.Distance;
import io.qdrant.client.grpc.Collections.VectorParams;
import io.qdrant.client.grpc.Points.Filter;
import io.qdrant.client.grpc.Points.PointStruct;
import io.qdrant.client.grpc.Points.Range;
import io.qdrant.client.grpc.Points.ScoredPoint;
import io.qdrant.client.grpc.Points.ScrollPoints;
import io.qdrant.client.grpc.Points.SearchPoints;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * 基于 Qdrant 的向量存储实现，支持双向量模式（semantic + code）。
 *
 * <p>连接地址和集合名称由 {@link QdrantProperties} 提供，使用 Qdrant Java SDK（gRPC）通信。
 * 启动时确保 collection 存在，连接失败时明确报错，不给出 Docker 启动提示。
 *
 * @author leolu
 * @since 0.1.0
 */
@Lazy
@Service
public class QdrantVectorStore implements VectorStore {

    private static final Logger log = LoggerFactory.getLogger(QdrantVectorStore.class);

    private static final String VECTOR_SEMANTIC = "semantic";
    private static final String VECTOR_CODE = "code";

    private final QdrantProperties properties;
    private final QdrantClient client;
    private final EmbeddingService embeddingService;

    /**
     * 通过构造器注入 Qdrant 配置、gRPC 客户端和 Embedding 服务。
     *
     * <p>{@code @Autowired} 显式标记此构造器，消除与测试用包私有构造器的歧义，
     * 确保 Spring AOT 能正确生成 bean 注册代码。
     *
     * @param properties       Qdrant 连接配置，不为 {@code null}
     * @param embeddingService 用于将查询字符串转换为向量的 Embedding 服务，不为 {@code null}
     */
    @Autowired
    public QdrantVectorStore(QdrantProperties properties, EmbeddingService embeddingService) {
        this.properties = properties;
        this.embeddingService = embeddingService;
        try {
            this.client = new QdrantClient(
                    QdrantGrpcClient.newBuilder(properties.host(), properties.port(), false).build()
            );
        } catch (Exception e) {
            throw new IllegalStateException(
                    "Failed to initialize Qdrant client for "
                    + properties.host() + ":" + properties.port()
                    + ". Ensure Qdrant is running.", e);
        }
    }

    /**
     * 用于单元测试的包私有构造器，接受外部预建的 {@link QdrantClient}，跳过 gRPC 连接初始化。
     *
     * @param properties       Qdrant 连接配置
     * @param embeddingService Embedding 服务
     * @param client           预建的 Qdrant 客户端（测试中通常为 Mock）
     */
    QdrantVectorStore(QdrantProperties properties, EmbeddingService embeddingService,
                      QdrantClient client) {
        this.properties = properties;
        this.embeddingService = embeddingService;
        this.client = client;
    }

    /**
     * 启动后确保 collection 存在，若不存在则创建（双向量，Cosine 距离）。
     */
    @PostConstruct
    public void ensureCollection() {
        String collection = properties.collection();
        int vectorSize = properties.vectorSize();
        try {
            List<String> existing = client.listCollectionsAsync().get();
            if (!existing.contains(collection)) {
                log.info("Creating Qdrant collection '{}' with vector size {}", collection, vectorSize);
                Map<String, VectorParams> vectors = Map.of(
                        VECTOR_SEMANTIC, VectorParams.newBuilder()
                                .setSize(vectorSize)
                                .setDistance(Distance.Cosine)
                                .build(),
                        VECTOR_CODE, VectorParams.newBuilder()
                                .setSize(vectorSize)
                                .setDistance(Distance.Cosine)
                                .build()
                );
                client.createCollectionAsync(collection, vectors).get();
                log.info("Collection '{}' created successfully.", collection);
            } else {
                log.debug("Collection '{}' already exists.", collection);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "Interrupted while connecting to Qdrant "
                    + properties.host() + ":" + properties.port(), e);
        } catch (ExecutionException e) {
            throw new IllegalStateException(
                    "Cannot connect to Qdrant at " + properties.host() + ":" + properties.port()
                    + ". Check that the service is running on that address and port.",
                    e.getCause());
        }
    }

    /**
     * 检查 Qdrant 服务是否可达，通过 {@code listCollectionsAsync()} 探测连通性，最多等待 3 秒。
     *
     * @return {@code true} 表示连接正常；{@code false} 表示超时或连接失败
     */
    public boolean isHealthy() {
        try {
            client.listCollectionsAsync().get(3, TimeUnit.SECONDS);
            return true;
        } catch (Exception e) {
            log.warn("Qdrant health check failed: {}", e.getMessage());
            return false;
        }
    }

    @Override
    public void upsert(List<EmbeddedUnit> units, String projectId) {
        if (units.isEmpty()) return;

        List<PointStruct> points = new ArrayList<>(units.size());
        for (EmbeddedUnit eu : units) {
            points.add(buildPoint(eu.unit(), eu.semanticVec(), eu.codeVec(), projectId));
        }

        try {
            client.upsertAsync(properties.collection(), points).get();
            log.debug("Upserted {} points to collection '{}'", points.size(), properties.collection());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted during Qdrant upsert", e);
        } catch (ExecutionException e) {
            throw new IllegalStateException(
                    "Qdrant upsert failed: " + e.getCause().getMessage(), e.getCause());
        }
    }

    /**
     * 使用预计算的查询向量执行语义检索（{@code semantic} 向量）。
     *
     * @param queryVector 查询向量，长度必须与集合向量维度一致
     * @param opts        检索选项，{@code null} 时使用 {@link SearchOptions#defaults()}
     * @return 按相似度降序排列的检索结果列表
     */
    public SearchPage semanticSearchByVector(float[] queryVector, SearchOptions opts) {
        return searchByVector(queryVector, VECTOR_SEMANTIC, opts != null ? opts : SearchOptions.defaults());
    }

    /**
     * 使用预计算的查询向量执行代码相似检索（{@code code} 向量）。
     *
     * @param queryVector 查询向量，长度必须与集合向量维度一致
     * @param opts        检索选项，{@code null} 时使用 {@link SearchOptions#defaults()}
     * @return 分页检索结果 {@link SearchPage}
     */
    public SearchPage codeSearchByVector(float[] queryVector, SearchOptions opts) {
        return searchByVector(queryVector, VECTOR_CODE, opts != null ? opts : SearchOptions.defaults());
    }

    @Override
    public SearchPage semanticSearch(String nlQuery, SearchOptions opts) {
        List<float[]> vecs = embeddingService.embed(List.of(nlQuery));
        return semanticSearchByVector(vecs.get(0), opts);
    }

    @Override
    public SearchPage codeSearch(String codeSnippet, SearchOptions opts) {
        List<float[]> vecs = embeddingService.embed(List.of(codeSnippet));
        return codeSearchByVector(vecs.get(0), opts);
    }

    private SearchPage searchByVector(float[] queryVector, String vectorName, SearchOptions opts) {
        Filter filter = buildFilter(opts);
        int safeOffset = Math.max(0, opts.offset());
        SearchPoints.Builder reqBuilder = SearchPoints.newBuilder()
                .setCollectionName(properties.collection())
                .setVectorName(vectorName)
                .setLimit(opts.limit())
                .setOffset(safeOffset)
                .setWithPayload(WithPayloadSelectorFactory.enable(true));

        for (float v : queryVector) {
            reqBuilder.addVector(v);
        }
        if (filter != null) {
            reqBuilder.setFilter(filter);
        }

        try {
            List<ScoredPoint> scored = client.searchAsync(reqBuilder.build()).get();
            List<SearchResult> results = scored.stream()
                    .map(p -> new SearchResult(payloadToCodeUnit(p.getPayloadMap()), p.getScore()))
                    .collect(Collectors.toList());
            return new SearchPage(results, safeOffset, opts.limit(), results.size() == opts.limit());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted during Qdrant search", e);
        } catch (ExecutionException e) {
            throw new IllegalStateException(
                    "Qdrant search failed: " + e.getCause().getMessage(), e.getCause());
        }
    }

    @Override
    public void removeByFile(String filePath, String projectId) {
        Filter filter = Filter.newBuilder()
                .addMust(ConditionFactory.matchKeyword("file_path", filePath))
                .addMust(ConditionFactory.matchKeyword("project_id", projectId))
                .build();
        try {
            client.deleteAsync(properties.collection(), filter).get();
            log.debug("Removed vectors for file '{}' in project '{}'", filePath, projectId);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while removing vectors for file " + filePath, e);
        } catch (ExecutionException e) {
            log.warn("Failed to remove vectors for file '{}' in project '{}': {}",
                    filePath, projectId, e.getCause().getMessage());
        }
    }

    @Override
    public void removeByProject(String projectId) {
        Filter filter = Filter.newBuilder()
                .addMust(ConditionFactory.matchKeyword("project_id", projectId))
                .build();
        try {
            client.deleteAsync(properties.collection(), filter).get();
            log.info("Removed all vectors for project '{}'", projectId);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while removing vectors for project " + projectId, e);
        } catch (ExecutionException e) {
            log.warn("Failed to remove vectors for project '{}': {}",
                    projectId, e.getCause().getMessage());
        }
    }

    @Override
    public Optional<CodeUnit> symbolLookup(String qualifiedName) {
        Filter filter = Filter.newBuilder()
                .addMust(ConditionFactory.matchKeyword("qualified_name", qualifiedName))
                .build();
        return scrollFirst(filter);
    }

    @Override
    public Optional<CodeUnit> locateByPosition(String filePath, int line) {
        Filter filter = Filter.newBuilder()
                .addMust(ConditionFactory.matchKeyword("file_path", filePath))
                .addMust(ConditionFactory.range("start_line",
                        Range.newBuilder().setLte(line).build()))
                .addMust(ConditionFactory.range("end_line",
                        Range.newBuilder().setGte(line).build()))
                .build();
        return scrollFirst(filter);
    }

    private Optional<CodeUnit> scrollFirst(Filter filter) {
        ScrollPoints req = ScrollPoints.newBuilder()
                .setCollectionName(properties.collection())
                .setFilter(filter)
                .setLimit(1)
                .setWithPayload(WithPayloadSelectorFactory.enable(true))
                .build();
        try {
            var result = client.scrollAsync(req).get();
            return result.getResultList().stream()
                    .findFirst()
                    .map(p -> payloadToCodeUnit(p.getPayloadMap()));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted during Qdrant scroll", e);
        } catch (ExecutionException e) {
            throw new IllegalStateException(
                    "Qdrant scroll failed: " + e.getCause().getMessage(), e.getCause());
        }
    }

    // ── Point 构建 ────────────────────────────────────────────────────────────

    private PointStruct buildPoint(CodeUnit unit, float[] semanticVec,
                                    float[] codeVec, String projectId) {
        return PointStruct.newBuilder()
                .setId(PointIdFactory.id(toUuid(unit.id())))
                .setVectors(VectorsFactory.namedVectors(Map.of(
                        VECTOR_SEMANTIC, VectorFactory.vector(semanticVec),
                        VECTOR_CODE,     VectorFactory.vector(codeVec)
                )))
                .putAllPayload(buildPayload(unit, projectId))
                .build();
    }

    /**
     * 将 SHA-256 十六进制 ID（64 位）转为 UUID（取前 128 位）。
     */
    private static UUID toUuid(String hexId) {
        String h = hexId.length() >= 32 ? hexId.substring(0, 32) : hexId;
        try {
            return UUID.fromString(
                    h.substring(0, 8) + "-" + h.substring(8, 12) + "-" +
                    h.substring(12, 16) + "-" + h.substring(16, 20) + "-" + h.substring(20, 32)
            );
        } catch (IllegalArgumentException e) {
            // 兜底：基于名称生成 UUID
            return UUID.nameUUIDFromBytes(hexId.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static Map<String, io.qdrant.client.grpc.JsonWithInt.Value> buildPayload(
            CodeUnit unit, String projectId) {
        Map<String, io.qdrant.client.grpc.JsonWithInt.Value> payload = new HashMap<>();
        payload.put("id",             ValueFactory.value(unit.id()));
        payload.put("kind",           ValueFactory.value(unit.kind().name()));
        payload.put("language",       ValueFactory.value(unit.language()));
        payload.put("qualified_name", ValueFactory.value(unit.qualifiedName()));
        payload.put("simple_name",    ValueFactory.value(unit.simpleName()));
        payload.put("file_path",      ValueFactory.value(unit.filePath()));
        payload.put("start_line",     ValueFactory.value((long) unit.startLine()));
        payload.put("end_line",       ValueFactory.value((long) unit.endLine()));
        payload.put("signature",      ValueFactory.value(unit.signature() != null ? unit.signature() : ""));
        payload.put("raw_source",     ValueFactory.value(unit.rawSource() != null ? unit.rawSource() : ""));
        payload.put("project_id",     ValueFactory.value(projectId));

        if (unit.parentQualifiedName() != null) {
            payload.put("parent_qname", ValueFactory.value(unit.parentQualifiedName()));
        }

        String annotationsJson = unit.annotations() == null ? "[]"
                : "[" + unit.annotations().stream()
                .map(a -> "\"" + a.replace("\"", "\\\"") + "\"")
                .collect(Collectors.joining(",")) + "]";
        payload.put("annotations", ValueFactory.value(annotationsJson));

        if (unit.metadata() != null) {
            unit.metadata().forEach((k, v) -> payload.put("metadata." + k, ValueFactory.value(v)));
        }

        return payload;
    }

    // ── 过滤器构建 ────────────────────────────────────────────────────────────

    private static Filter buildFilter(SearchOptions opts) {
        Filter.Builder filter = Filter.newBuilder();
        boolean hasCondition = false;

        if (opts.language() != null) {
            filter.addMust(ConditionFactory.matchKeyword("language", opts.language()));
            hasCondition = true;
        }
        if (opts.kind() != null) {
            filter.addMust(ConditionFactory.matchKeyword("kind", opts.kind().name()));
            hasCondition = true;
        }
        if (opts.projectId() != null) {
            filter.addMust(ConditionFactory.matchKeyword("project_id", opts.projectId()));
            hasCondition = true;
        }
        if (opts.entryOnly()) {
            filter.addMust(ConditionFactory.matchKeyword("metadata.is_entry_point", "true"));
            hasCondition = true;
        }
        if (opts.noTest()) {
            filter.addMustNot(ConditionFactory.matchKeyword("metadata.is_test", "true"));
            hasCondition = true;
        }

        return hasCondition ? filter.build() : null;
    }

    // ── Payload → CodeUnit 反序列化 ───────────────────────────────────────────

    private static CodeUnit payloadToCodeUnit(
            Map<String, io.qdrant.client.grpc.JsonWithInt.Value> payload) {
        String id = str(payload, "id");
        CodeUnitKind kind = CodeUnitKind.valueOf(str(payload, "kind"));
        String language = str(payload, "language");
        String qualifiedName = str(payload, "qualified_name");
        String simpleName = str(payload, "simple_name");
        String filePath = str(payload, "file_path");
        int startLine = (int) longVal(payload, "start_line");
        int endLine = (int) longVal(payload, "end_line");
        String rawSource = str(payload, "raw_source");
        String signature = str(payload, "signature");
        String parentQn = payload.containsKey("parent_qname") ? str(payload, "parent_qname") : null;

        Map<String, String> metadata = new HashMap<>();
        payload.forEach((k, v) -> {
            if (k.startsWith("metadata.")) {
                metadata.put(k.substring("metadata.".length()), v.getStringValue());
            }
        });

        return new CodeUnit(id, kind, language, qualifiedName, simpleName, filePath,
                startLine, endLine, rawSource, signature,
                Collections.emptyList(), parentQn, metadata);
    }

    private static String str(Map<String, io.qdrant.client.grpc.JsonWithInt.Value> payload,
                               String key) {
        var v = payload.get(key);
        return v != null ? v.getStringValue() : "";
    }

    private static long longVal(Map<String, io.qdrant.client.grpc.JsonWithInt.Value> payload,
                                 String key) {
        var v = payload.get(key);
        return v != null ? v.getIntegerValue() : 0L;
    }
}
