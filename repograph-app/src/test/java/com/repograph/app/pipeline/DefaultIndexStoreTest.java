package com.repograph.app.pipeline;

import com.repograph.core.vector.VectorStore;
import com.repograph.graph.CodeGraph;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.LockSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 验证跨存储删除的持久重试与同项目互斥。
 *
 * @author leolu
 */
@ExtendWith(MockitoExtension.class)
class DefaultIndexStoreTest {
    @TempDir Path tempDir;
    @Mock CodeGraph codeGraph;
    @Mock VectorStore vectorStore;
    private IncrementalIndexCache cache;
    private DefaultIndexStore store;

    @BeforeEach
    void setUp() {
        cache = reopenCache();
        store = new DefaultIndexStore(codeGraph, vectorStore, cache);
    }

    @Test
    void removeFileCompletesBothStoresBeforeClearingRetryMarker() {
        store.removeFile("Foo.java", "project");
        var order = inOrder(codeGraph, vectorStore);
        order.verify(codeGraph).removeByFile("Foo.java", "project");
        order.verify(vectorStore).removeByFile("Foo.java", "project");
        assertThat(cache.findDeletedPaths(List.of(), "project", tempDir)).isEmpty();
    }

    @Test
    void failedVectorDeletionRemainsDiscoverableAfterRestartAndCanBeRetried() {
        doThrow(new IllegalStateException("Qdrant unavailable")).doNothing()
                .when(vectorStore).removeByFile("Foo.java", "project");
        assertThatThrownBy(() -> store.removeFile("Foo.java", "project"))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("Qdrant unavailable");
        IncrementalIndexCache reopened = reopenCache();
        assertThat(reopened.findDeletedPaths(List.of(), "project", tempDir)).containsExactly("Foo.java");
        new DefaultIndexStore(codeGraph, vectorStore, reopened).removeFile("Foo.java", "project");
        assertThat(reopened.findDeletedPaths(List.of(), "project", tempDir)).isEmpty();
    }

    @Test
    void graphFailurePreservesRetryMarkerAndDoesNotDeleteVectors() {
        doThrow(new IllegalStateException("Neo4j unavailable"))
                .when(codeGraph).removeByFile("Foo.java", "project");
        assertThatThrownBy(() -> store.removeFile("Foo.java", "project"))
                .isInstanceOf(IllegalStateException.class);
        assertThat(cache.findDeletedPaths(List.of(), "project", tempDir)).containsExactly("Foo.java");
        verifyNoInteractions(vectorStore);
    }

    @Test
    void failedRetryRegistrationPreventsExternalSideEffects() {
        IncrementalIndexCache unavailable = spy(cache);
        doThrow(new IllegalStateException("SQLite unavailable")).when(unavailable).markDirty(any(), any());
        DefaultIndexStore subject = new DefaultIndexStore(codeGraph, vectorStore, unavailable);
        assertThatThrownBy(() -> subject.removeFile("Foo.java", "project"))
                .isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(codeGraph, vectorStore);
    }

    @Test
    void projectDeletionFailureRemainsPendingEvenWithoutCachedFiles() {
        doThrow(new IllegalStateException("Qdrant unavailable")).doNothing()
                .when(vectorStore).removeByProject("project");
        assertThatThrownBy(() -> store.removeProject("project")).isInstanceOf(IllegalStateException.class);
        IncrementalIndexCache reopened = reopenCache();
        assertThat(reopened.hasPendingProjectDeletion("project")).isTrue();
        new DefaultIndexStore(codeGraph, vectorStore, reopened).removeProject("project");
        assertThat(reopened.hasPendingProjectDeletion("project")).isFalse();
    }

    @Test
    void projectMutationIsReentrantAndReleasesLockAfterFailure() {
        String nested = store.withProjectMutation("project",
                () -> store.withProjectMutation("project", () -> "done"));
        assertThat(nested).isEqualTo("done");
        assertThatThrownBy(() -> store.withProjectMutation("project", () -> {
            throw new IllegalArgumentException("failed");
        })).isInstanceOf(IllegalArgumentException.class);
        String retry = store.withProjectMutation("project", () -> "retry");
        assertThat(retry).isEqualTo("retry");
    }

    @Test
    void sameProjectMutationsCannotOverlapAcrossStoreInstances() throws Exception {
        DefaultIndexStore other = new DefaultIndexStore(codeGraph, vectorStore, cache);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch secondAttempt = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> store.withProjectMutation("project", () -> {
                entered.countDown();
                try {
                    if (!release.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("release timeout");
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(error);
                }
                return "first";
            }));
            try {
                assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
                var second = executor.submit(() -> {
                    secondAttempt.countDown();
                    return other.withProjectMutation("project", () -> "second");
                });
                assertThat(secondAttempt.await(5, TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(() -> second.get(300, TimeUnit.MILLISECONDS))
                        .isInstanceOf(TimeoutException.class);
                release.countDown();
                assertThat(first.get(5, TimeUnit.SECONDS)).isEqualTo("first");
                assertThat(second.get(5, TimeUnit.SECONDS)).isEqualTo("second");
            } finally {
                release.countDown();
            }
        }
    }

    @Test
    void alreadyInterruptedMutationDoesNotExecuteAction() {
        AtomicBoolean executed = new AtomicBoolean();
        Thread.currentThread().interrupt();
        try {
            assertThatThrownBy(() -> store.withProjectMutation("project", () -> {
                executed.set(true);
                return null;
            })).isInstanceOf(IllegalStateException.class).hasCauseInstanceOf(InterruptedException.class);
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
            assertThat(executed).isFalse();
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void interruptedLockWaitExitsBeforeOwnerReleasesWithoutExecutingAction() throws Exception {
        AtomicBoolean executed = new AtomicBoolean();
        AtomicBoolean interruptPreserved = new AtomicBoolean();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        CountDownLatch finished = new CountDownLatch(1);
        Thread waiter = new Thread(() -> {
            try {
                store.withProjectMutation("project", () -> {
                    executed.set(true);
                    return null;
                });
            } catch (RuntimeException error) {
                failure.set(error);
            } finally {
                interruptPreserved.set(Thread.currentThread().isInterrupted());
                finished.countDown();
            }
        }, "test-project-lock-waiter");
        try {
            store.withProjectMutation("project", () -> {
                waiter.start();
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
                while (waiter.getState() != Thread.State.WAITING && waiter.isAlive()
                        && System.nanoTime() < deadline) {
                    LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(1));
                }
                assertThat(waiter.getState()).isEqualTo(Thread.State.WAITING);
                waiter.interrupt();
                try {
                    assertThat(finished.await(1, TimeUnit.SECONDS)).isTrue();
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(error);
                }
                return null;
            });
        } finally {
            waiter.interrupt();
            waiter.join(5_000);
        }

        assertThat(waiter.isAlive()).isFalse();
        assertThat(failure.get()).isInstanceOf(IllegalStateException.class)
                .hasCauseInstanceOf(InterruptedException.class);
        assertThat(interruptPreserved).isTrue();
        assertThat(executed).isFalse();
        String retried = store.withProjectMutation("project", () -> "retry");
        assertThat(retried).isEqualTo("retry");
    }

    private IncrementalIndexCache reopenCache() {
        return new IncrementalIndexCache(tempDir.resolve("index.db").toString());
    }
}
