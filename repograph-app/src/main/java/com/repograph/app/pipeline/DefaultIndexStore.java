package com.repograph.app.pipeline;

import com.repograph.core.pipeline.IndexStore;
import com.repograph.core.vector.VectorStore;
import com.repograph.graph.CodeGraph;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;
import java.util.stream.IntStream;

/**
 * 协调图、向量与增量缓存的变更和持久清理重试。
 *
 * <p>先持久化未完成标记，再依次删除图和向量；全部成功后才清除标记。
 * 任一存储失败均向上传播，下次索引或删除可幂等重试。
 * 同项目操作在进程内串行；固定数量的可重入锁避免长期保留项目 ID。
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class DefaultIndexStore implements IndexStore {

    private static final ReentrantLock[] PROJECT_LOCKS = IntStream.range(0, 256)
            .mapToObj(ignored -> new ReentrantLock()).toArray(ReentrantLock[]::new);

    private final CodeGraph codeGraph;
    private final VectorStore vectorStore;
    private final IncrementalIndexCache incrementalCache;

    /**
     * 通过构造器注入图、向量存储与增量缓存。
     *
     * @param codeGraph Neo4j 图门面
     * @param vectorStore 向量存储服务
     * @param incrementalCache 持久化增量状态
     */
    public DefaultIndexStore(CodeGraph codeGraph, VectorStore vectorStore,
                             IncrementalIndexCache incrementalCache) {
        this.codeGraph = codeGraph;
        this.vectorStore = vectorStore;
        this.incrementalCache = incrementalCache;
    }

    /** {@inheritDoc} */
    @Override
    public <T> T withProjectMutation(String projectId, Supplier<T> action) {
        Objects.requireNonNull(projectId, "projectId");
        Objects.requireNonNull(action, "action");
        ReentrantLock lock = PROJECT_LOCKS[Math.floorMod(projectId.hashCode(), PROJECT_LOCKS.length)];
        try {
            lock.lockInterruptibly();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while waiting to mutate project: " + projectId, error);
        }
        try {
            return action.get();
        } finally {
            lock.unlock();
        }
    }

    /** {@inheritDoc} */
    @Override
    public void removeFile(String filePath, String projectId) {
        withProjectMutation(projectId, () -> {
            incrementalCache.markDirty(List.of(filePath), projectId);
            codeGraph.removeByFile(filePath, projectId);
            vectorStore.removeByFile(filePath, projectId);
            incrementalCache.removeEntry(filePath, projectId);
            return null;
        });
    }

    /** {@inheritDoc} */
    @Override
    public void removeProject(String projectId) {
        withProjectMutation(projectId, () -> {
            incrementalCache.markProjectDeletionPending(projectId);
            codeGraph.removeByProject(projectId);
            vectorStore.removeByProject(projectId);
            incrementalCache.removeProject(projectId);
            incrementalCache.completeProjectDeletion(projectId);
            return null;
        });
    }
}
