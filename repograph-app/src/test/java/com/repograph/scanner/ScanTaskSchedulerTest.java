package com.repograph.scanner;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link ScanTaskScheduler} 并发配额准入测试：用阻塞任务体占住配额，断言各维度并发峰值不超上限，
 * 且释放后全部排空。
 *
 * @author leolu
 */
class ScanTaskSchedulerTest {

    private final ExecutorService pool = Executors.newFixedThreadPool(16);

    @AfterEach
    void tearDown() {
        pool.shutdownNow();
    }

    @Test
    void globalLimitCapsConcurrentTasksAndQueuesTheRest() throws Exception {
        // 全局上限 2，项目/扫描器上限放大以隔离全局维度。
        ScanTaskScheduler scheduler = new ScanTaskScheduler(pool, 2, 100, 100);
        Tracker tracker = new Tracker();
        CountDownLatch started = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(5);

        for (int i = 0; i < 5; i++) {
            // 每个任务独立项目 + 扫描器，只有全局维度会限制。
            submit(scheduler, tracker, "p" + i, List.of("s" + i), started, release, done);
        }

        assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
        assertThat(scheduler.pendingSize()).isEqualTo(3);
        assertThat(tracker.globalMax()).isEqualTo(2);

        release.countDown();
        assertThat(done.await(5, TimeUnit.SECONDS)).isTrue();
        assertThat(tracker.globalMax()).isEqualTo(2);
        assertThat(tracker.totalStarted()).isEqualTo(5);
        assertThat(scheduler.pendingSize()).isZero();
    }

    @Test
    void perProjectLimitDoesNotStarveOtherProjects() throws Exception {
        // 项目上限 1，全局/扫描器放大：同项目最多 1 个在飞，但不同项目可并发。
        ScanTaskScheduler scheduler = new ScanTaskScheduler(pool, 100, 1, 100);
        Tracker tracker = new Tracker();
        CountDownLatch started = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(6);

        for (int i = 0; i < 3; i++) {
            submit(scheduler, tracker, "p1", List.of("s" + i), started, release, done);
        }
        for (int i = 0; i < 3; i++) {
            submit(scheduler, tracker, "p2", List.of("s" + i), started, release, done);
        }

        // p1、p2 各准入 1 个 → 全局并发达到 2（互不饿死）。
        assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
        assertThat(tracker.projectMax("p1")).isEqualTo(1);
        assertThat(tracker.projectMax("p2")).isEqualTo(1);
        assertThat(tracker.globalMax()).isGreaterThanOrEqualTo(2);

        release.countDown();
        assertThat(done.await(5, TimeUnit.SECONDS)).isTrue();
        assertThat(tracker.projectMax("p1")).isEqualTo(1);
        assertThat(tracker.projectMax("p2")).isEqualTo(1);
        assertThat(tracker.totalStarted()).isEqualTo(6);
    }

    private static void submit(
            ScanTaskScheduler scheduler, Tracker tracker, String projectId, List<String> scanners,
            CountDownLatch started, CountDownLatch release, CountDownLatch done) {
        scheduler.submit(projectId + "-" + scanners, projectId, scanners, () -> {
            tracker.enter(projectId);
            started.countDown();
            try {
                release.await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            tracker.exit(projectId);
            done.countDown();
        });
    }

    /** 记录各维度并发峰值。 */
    private static final class Tracker {
        private int global;
        private int globalMax;
        private int totalStarted;
        private final Map<String, Integer> projectNow = new HashMap<>();
        private final Map<String, Integer> projectMax = new HashMap<>();

        synchronized void enter(String projectId) {
            global++;
            totalStarted++;
            globalMax = Math.max(globalMax, global);
            int now = projectNow.merge(projectId, 1, Integer::sum);
            projectMax.merge(projectId, now, Integer::max);
        }

        synchronized void exit(String projectId) {
            global--;
            projectNow.merge(projectId, -1, Integer::sum);
        }

        synchronized int globalMax() {
            return globalMax;
        }

        synchronized int projectMax(String projectId) {
            return projectMax.getOrDefault(projectId, 0);
        }

        synchronized int totalStarted() {
            return totalStarted;
        }
    }
}
