package com.repograph.app.pipeline;

import com.repograph.app.config.IndexProperties;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.vector.EmbeddedUnit;
import com.repograph.core.vector.EmbeddingService;
import com.repograph.core.vector.VectorStore;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

/**
 * 构建语义/代码双向量嵌入，并将嵌入后的代码单元写入向量存储。
 *
 * @author leolu
 * @since 0.1.0
 */
@Component
class EmbeddingUpsertRunner {

    private static final Logger log = LoggerFactory.getLogger(EmbeddingUpsertRunner.class);

    private static final int DEFAULT_EMBED_BATCH = 8;
    private static final int DEFAULT_UPSERT_BATCH = 256;
    private static final int DEFAULT_EMBED_PARALLELISM = 4;
    private static final int MAX_EMBED_ATTEMPTS = 3;
    private static final long RETRY_DELAY_MS = 200L;

    private final EmbeddingService embeddingService;
    private final VectorStore vectorStore;
    private final int embedBatchSize;
    private final int upsertBatchSize;
    private final ExecutorService embedExecutor;

    EmbeddingUpsertRunner(EmbeddingService embeddingService, VectorStore vectorStore,
                          IndexProperties indexProperties) {
        this.embeddingService = embeddingService;
        this.vectorStore = vectorStore;

        IndexProperties.BatchSize bs = indexProperties != null ? indexProperties.batchSize() : null;
        this.embedBatchSize = (bs != null && bs.embed() > 0) ? bs.embed() : DEFAULT_EMBED_BATCH;
        this.upsertBatchSize = (bs != null && bs.upsert() > 0) ? bs.upsert() : DEFAULT_UPSERT_BATCH;
        int parallelism = (bs != null && bs.parallelism() > 0) ? bs.parallelism() : DEFAULT_EMBED_PARALLELISM;
        this.embedExecutor = Executors.newFixedThreadPool(2 * parallelism, r -> {
            Thread thread = new Thread(r, "repograph-embed");
            thread.setDaemon(true);
            return thread;
        });
    }

    @PreDestroy
    void shutdown() {
        embedExecutor.shutdownNow();
    }

    int embedAndUpsert(List<CodeUnit> units, String projectId, Path projectRoot,
                       List<String> errors, ProgressCallback progressCallback) {
        if (units.isEmpty()) return 0;

        // 构建父类查找表，用于语义文本增强
        // 仅类级单元（CLASS/INTERFACE/ENUM/ANNOTATION/RECORD）作为父类
        Map<String, CodeUnit> parentByQn = units.stream()
                .filter(u -> isClassLevel(u.kind()))
                .collect(Collectors.toMap(CodeUnit::qualifiedName, u -> u, (a, b) -> a));

        AtomicInteger total = new AtomicInteger();
        List<CompletableFuture<Void>> futures = new ArrayList<>();

        for (int i = 0; i < units.size(); i += embedBatchSize) {
            final int offset = i;
            final List<CodeUnit> batch = units.subList(i, Math.min(i + embedBatchSize, units.size()));

            List<String> semanticTexts = new ArrayList<>(batch.size());
            List<String> codeTexts = new ArrayList<>(batch.size());
            for (CodeUnit unit : batch) {
                semanticTexts.add(buildSemanticText(unit, parentByQn));
                codeTexts.add(unit.rawSource() != null ? unit.rawSource() : "");
            }

            CompletableFuture<List<float[]>> semanticFuture =
                    CompletableFuture.supplyAsync(() -> embedWithRetry(semanticTexts), embedExecutor);
            CompletableFuture<List<float[]>> codeFuture =
                    CompletableFuture.supplyAsync(() -> embedWithRetry(codeTexts), embedExecutor);

            CompletableFuture<Void> batchFuture = semanticFuture
                    .thenCombine(codeFuture, (semanticVectors, codeVectors) -> {
                        List<EmbeddedUnit> embedded = new ArrayList<>(batch.size());
                        for (int k = 0; k < batch.size(); k++) {
                            embedded.add(new EmbeddedUnit(batch.get(k), semanticVectors.get(k), codeVectors.get(k)));
                        }
                        return embedded;
                    })
                    .thenAccept(embedded -> {
                        for (int j = 0; j < embedded.size(); j += upsertBatchSize) {
                            int end = Math.min(j + upsertBatchSize, embedded.size());
                            List<EmbeddedUnit> chunk = embedded.subList(j, end);
                            vectorStore.upsert(chunk, projectId);
                            int done = total.addAndGet(chunk.size());
                            progressCallback.publish(projectRoot.toString(), done, units.size());
                        }
                    })
                    .exceptionally(e -> {
                        Throwable cause = e.getCause() != null ? e.getCause() : e;
                        log.error("Embed/upsert failed for batch at offset {}: {}", offset, cause.getMessage());
                        synchronized (errors) {
                            errors.add("Embed/upsert error at offset " + offset + ": " + cause.getMessage());
                        }
                        return null;
                    });

            futures.add(batchFuture);
        }

        CompletableFuture.allOf(futures.toArray(new CompletableFuture<?>[0])).join();
        log.debug("Parallel embed+upsert complete: {} units", total.get());
        return total.get();
    }

    private List<float[]> embedWithRetry(List<String> texts) {
        RuntimeException lastError = null;
        for (int attempt = 1; attempt <= MAX_EMBED_ATTEMPTS; attempt++) {
            try {
                return embeddingService.embed(texts);
            } catch (RuntimeException error) {
                lastError = error;
                if (attempt == MAX_EMBED_ATTEMPTS) {
                    break;
                }
                log.warn("Embedding attempt {}/{} failed; retrying: {}",
                        attempt, MAX_EMBED_ATTEMPTS, error.getMessage());
                try {
                    Thread.sleep(RETRY_DELAY_MS * attempt);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("Embedding retry interrupted", interrupted);
                }
            }
        }
        throw lastError;
    }

    /**
     * 为代码单元构建语义嵌入输入文本。
     *
     * <p>类级单元：自身 Javadoc 摘要 + 注解 + 签名。
     *
     * <p>成员单元（METHOD/CONSTRUCTOR/FIELD）：前置父类上下文
     * （Javadoc 摘要 + 类注解 + 类签名），再拼接自身 Javadoc 摘要及注解 + 签名。
     * 自身 Javadoc 是检索信号最强的文本——用自然语言描述意图，与自然语言查询直接匹配。
     */
    static String buildSemanticText(CodeUnit unit, Map<String, CodeUnit> parentByQn) {
        // 文档单元直接使用原始正文，最大 1024 字符
        if (unit.kind() == CodeUnitKind.DOCUMENT) {
            String raw = unit.rawSource() != null ? unit.rawSource().trim() : "";
            return raw.length() > 1024 ? raw.substring(0, 1024) : raw;
        }

        StringBuilder sb = new StringBuilder();

        // 为非类级单元前置父类上下文
        if (!isClassLevel(unit.kind()) && unit.parentQualifiedName() != null) {
            CodeUnit parent = parentByQn.get(unit.parentQualifiedName());
            if (parent != null) {
                // 前置 Javadoc 摘要（rawSource 中第一个有意义的段落）
                String doc = extractDocSummary(parent.rawSource());
                if (!doc.isEmpty()) sb.append(doc).append(". ");

                // Class-level framework annotations (@Service, @Component, @Controller, …)
                if (!parent.annotations().isEmpty()) {
                    sb.append(String.join(" ", parent.annotations())).append(" ");
                }
                // 类签名（如 "class SourceFileScanner" / "public class JavaCodeParser"）
                if (parent.signature() != null) {
                    sb.append(parent.signature()).append(" ");
                }
            }
        }

        // 单元自身的 Javadoc 摘要：最具描述性的自然语言文本
        String ownDoc = extractDocSummary(unit.rawSource());
        if (!ownDoc.isEmpty()) {
            sb.append(ownDoc).append(". ");
        }

        // 单元自身的注解与签名
        if (unit.annotations() != null && !unit.annotations().isEmpty()) {
            sb.append(String.join(" ", unit.annotations())).append(" ");
        }
        if (unit.signature() != null) {
            sb.append(unit.signature());
        }
        return sb.toString().trim();
    }

    /**
     * 从 rawSource 中的 Javadoc 或块注释提取第一个有意义的句子。
     * 去除注释分隔符和行首星号，跳过空行与 @tag 行，
     * 在第一个句号或超过 120 个字符时截断。
     * 未找到可用注释时返回空字符串。
     */
    static String extractDocSummary(String rawSource) {
        if (rawSource == null || rawSource.isBlank()) return "";

        int start = rawSource.indexOf("/**");
        if (start < 0) {
            // 降级：尝试文件开头的单行或块注释
            start = rawSource.indexOf("/*");
        }
        if (start < 0) return "";
        // 从 start + 2 开始找闭合标记：避免闭合 "*/" 与刚匹配到的开头 "/*" 重叠
        // （例如源码中出现 "/*/" 时，从 start 搜索会把开头自身的 '*' 当成闭合标记的一部分，
        // 产生 end < start + 2，导致下面的 substring 抛 StringIndexOutOfBoundsException）
        int end = rawSource.indexOf("*/", start + 2);
        if (end < 0) return "";

        String block = rawSource.substring(start + 2, end); // 去除 /* 前缀和 */ 后缀
        StringBuilder summary = new StringBuilder();

        for (String raw : block.split("\n")) {
            // 去除行首空白、可选的 * 及其后空白
            String line = raw.replaceAll("^\\s*\\*?\\s?", "").trim();
            if (line.isEmpty() || line.startsWith("@") || line.equals("*")) continue;
            if (!summary.isEmpty()) summary.append(" ");
            summary.append(line);
            // 在第一个句子结束处截断
            int dot = summary.indexOf(".");
            if (dot >= 0) {
                return summary.substring(0, dot + 1).trim();
            }
            if (summary.length() >= 120) break;
        }
        return summary.toString().trim();
    }

    private static boolean isClassLevel(CodeUnitKind kind) {
        return kind == CodeUnitKind.CLASS
                || kind == CodeUnitKind.INTERFACE
                || kind == CodeUnitKind.ENUM
                || kind == CodeUnitKind.ANNOTATION
                || kind == CodeUnitKind.STRUCT
                || kind == CodeUnitKind.UNION
                || kind == CodeUnitKind.TYPEDEF;
    }

    @FunctionalInterface
    interface ProgressCallback {
        void publish(String projectRoot, int done, int total);
    }
}
