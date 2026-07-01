package com.repograph.app.pipeline;

import com.repograph.core.vector.VectorStore;
import com.repograph.graph.CodeGraph;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;

/**
 * {@link DefaultIndexStore} 单元测试，验证图和向量存储的联动删除协调逻辑。
 *
 * @author leolu
 * @since 0.1.0
 */
@ExtendWith(MockitoExtension.class)
class DefaultIndexStoreTest {

    @Mock
    CodeGraph codeGraph;
    @Mock
    VectorStore vectorStore;
    @Mock
    IncrementalIndexCache incrementalCache;

    private DefaultIndexStore store;

    @BeforeEach
    void setUp() {
        store = new DefaultIndexStore(codeGraph, vectorStore, incrementalCache);
    }

    @Test
    void removeFile_cleansGraphVectorAndCache() {
        store.removeFile("src/Foo.java", "proj1");

        InOrder order = inOrder(codeGraph, vectorStore, incrementalCache);
        order.verify(codeGraph).removeByFile("src/Foo.java", "proj1");
        order.verify(vectorStore).removeByFile("src/Foo.java", "proj1");
        order.verify(incrementalCache).removeEntry("src/Foo.java", "proj1");
    }

    @Test
    void removeFile_vectorStoreFails_cacheStillCleaned() {
        doThrow(new RuntimeException("Qdrant unavailable"))
                .when(vectorStore).removeByFile(any(), any());

        store.removeFile("src/Foo.java", "proj1");

        verify(codeGraph).removeByFile("src/Foo.java", "proj1");
        verify(incrementalCache).removeEntry("src/Foo.java", "proj1");
    }

    @Test
    void removeFile_cacheFails_doesNotRethrow() {
        doThrow(new RuntimeException("SQLite locked"))
                .when(incrementalCache).removeEntry(any(), any());

        store.removeFile("src/Foo.java", "proj1");

        verify(codeGraph).removeByFile("src/Foo.java", "proj1");
        verify(vectorStore).removeByFile("src/Foo.java", "proj1");
    }

    @Test
    void removeProject_invokesAllThreeStoresInOrder() {
        store.removeProject("abc123");

        InOrder order = inOrder(codeGraph, vectorStore, incrementalCache);
        order.verify(codeGraph).removeByProject("abc123");
        order.verify(vectorStore).removeByProject("abc123");
        order.verify(incrementalCache).removeProject("abc123");
    }

    @Test
    void removeProject_vectorOrCacheFailure_doesNotRethrow_butGraphAlreadyDone() {
        doThrow(new RuntimeException("Qdrant unavailable"))
                .when(vectorStore).removeByProject(any());
        doThrow(new RuntimeException("SQLite locked"))
                .when(incrementalCache).removeProject(any());

        // Graph delete already happened before the failures; we don't rethrow.
        store.removeProject("abc123");

        verify(codeGraph).removeByProject("abc123");
        verify(vectorStore).removeByProject("abc123");
        verify(incrementalCache).removeProject("abc123");
    }
}
