package com.repograph.app.pipeline;

import com.repograph.core.pipeline.IndexStore;
import com.repograph.core.vector.VectorStore;
import com.repograph.graph.CodeGraph;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * {@link IndexStore} 的默认实现，协调图（Neo4j）和向量存储的联动删除。
 *
 * <p>{@link #removeFile} 遵循 best-effort 策略：
 * <ol>
 *   <li>先删图节点和边（失败则向上抛出，不继续）</li>
 *   <li>再删向量点（失败仅 WARN，不阻断后续流程）</li>
 * </ol>
 * 图在失败时保持一致，向量可能滞后但可在下次索引时通过 upsert 覆盖。
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class DefaultIndexStore implements IndexStore {

    private static final Logger log = LoggerFactory.getLogger(DefaultIndexStore.class);

    private final CodeGraph codeGraph;
    private final VectorStore vectorStore;
    private final IncrementalIndexCache incrementalCache;

    /**
     * 通过构造器注入图、向量存储与增量缓存。
     *
     * @param codeGraph        Neo4j 图门面，不为 {@code null}
     * @param vectorStore      向量存储服务，不为 {@code null}
     * @param incrementalCache 增量索引 SQLite 缓存，不为 {@code null}
     */
    @Autowired
    public DefaultIndexStore(CodeGraph codeGraph, VectorStore vectorStore,
                              IncrementalIndexCache incrementalCache) {
        this.codeGraph = codeGraph;
        this.vectorStore = vectorStore;
        this.incrementalCache = incrementalCache;
    }

    @Override
    public void removeFile(String filePath, String projectId) {
        codeGraph.removeByFile(filePath, projectId);
        try {
            vectorStore.removeByFile(filePath, projectId);
        } catch (Exception e) {
            log.warn("Vector store removal failed for '{}' in project '{}'; " +
                     "graph is ahead of vectors until next upsert: {}",
                    filePath, projectId, e.getMessage());
        }
        try {
            incrementalCache.removeEntry(filePath, projectId);
        } catch (Exception e) {
            log.warn("Cache entry removal failed for '{}': {}", filePath, e.getMessage());
        }
    }

    @Override
    public void removeProject(String projectId) {
        // 优先写图 —— 此处失败会抛出异常，从用户角度看项目记录仍视为存在
        codeGraph.removeByProject(projectId);
        try {
            vectorStore.removeByProject(projectId);
        } catch (Exception e) {
            log.warn("Vector store removal failed for project '{}'; stale vectors remain: {}",
                    projectId, e.getMessage());
        }
        try {
            incrementalCache.removeProject(projectId);
        } catch (Exception e) {
            log.warn("Cache cleanup failed for project '{}': {}", projectId, e.getMessage());
        }
    }
}
