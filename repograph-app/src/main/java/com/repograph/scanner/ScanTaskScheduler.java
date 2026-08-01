package com.repograph.scanner;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;

/**
 * 扫描任务准入调度器：在全局、项目和扫描器三个维度限制并发在飞任务数。超额任务留在待入队列，
 * 直到有配额释放才按入队顺序被准入执行。
 *
 * <p>准入是工作保守（work-conserving）的：遍历待队列时跳过因某维度达上限而暂不可准入的任务，
 * 放行其后合格的任务，避免单个项目或扫描器达上限时饿死其他任务。
 *
 * @author leolu
 */
@Component
public class ScanTaskScheduler {

    private final Executor executor;
    private final int globalLimit;
    private final int projectLimit;
    private final int scannerLimit;

    private final Object lock = new Object();
    private final Deque<Pending> queue = new ArrayDeque<>();
    private int globalInFlight;
    private final Map<String, Integer> projectInFlight = new HashMap<>();
    private final Map<String, Integer> scannerInFlight = new HashMap<>();

    /**
     * 创建调度器。
     *
     * @param executor     准入后任务的执行 executor（线程数应 ≥ 全局上限）
     * @param globalLimit  全局在飞任务上限
     * @param projectLimit 单项目在飞任务上限
     * @param scannerLimit 单扫描器在飞任务上限（任务计入其包含的每个扫描器）
     */
    public ScanTaskScheduler(
            @Qualifier("scanTaskExecutor") Executor executor,
            @Value("${repograph.scanner.quota.global:4}") int globalLimit,
            @Value("${repograph.scanner.quota.project:2}") int projectLimit,
            @Value("${repograph.scanner.quota.scanner:2}") int scannerLimit) {
        this.executor = executor;
        this.globalLimit = Math.max(1, globalLimit);
        this.projectLimit = Math.max(1, projectLimit);
        this.scannerLimit = Math.max(1, scannerLimit);
    }

    /**
     * 提交一个任务参与调度。满足三类配额时立即准入执行，否则入队等待。
     *
     * @param taskId    任务标识
     * @param projectId 项目标识
     * @param scanners  任务包含的扫描器
     * @param task      准入后要执行的任务体
     */
    public void submit(String taskId, String projectId, Collection<String> scanners, Runnable task) {
        synchronized (lock) {
            queue.addLast(new Pending(taskId, projectId, List.copyOf(scanners), task));
        }
        drain();
    }

    private void drain() {
        List<Pending> admitted = new ArrayList<>();
        synchronized (lock) {
            Iterator<Pending> it = queue.iterator();
            while (it.hasNext()) {
                Pending pending = it.next();
                if (canAdmit(pending)) {
                    acquire(pending);
                    it.remove();
                    admitted.add(pending);
                }
            }
        }
        for (Pending pending : admitted) {
            executor.execute(() -> {
                try {
                    pending.task().run();
                } finally {
                    synchronized (lock) {
                        release(pending);
                    }
                    drain();
                }
            });
        }
    }

    private boolean canAdmit(Pending pending) {
        if (globalInFlight >= globalLimit) {
            return false;
        }
        if (projectInFlight.getOrDefault(pending.projectId(), 0) >= projectLimit) {
            return false;
        }
        for (String scanner : pending.scanners()) {
            if (scannerInFlight.getOrDefault(scanner, 0) >= scannerLimit) {
                return false;
            }
        }
        return true;
    }

    private void acquire(Pending pending) {
        globalInFlight++;
        projectInFlight.merge(pending.projectId(), 1, Integer::sum);
        for (String scanner : pending.scanners()) {
            scannerInFlight.merge(scanner, 1, Integer::sum);
        }
    }

    private void release(Pending pending) {
        globalInFlight--;
        decrement(projectInFlight, pending.projectId());
        for (String scanner : pending.scanners()) {
            decrement(scannerInFlight, scanner);
        }
    }

    private static void decrement(Map<String, Integer> counts, String key) {
        counts.compute(key, (k, value) -> value == null || value <= 1 ? null : value - 1);
    }

    /**
     * 当前等待入队的任务数，仅供测试与诊断使用。
     *
     * @return 待入队任务数
     */
    int pendingSize() {
        synchronized (lock) {
            return queue.size();
        }
    }

    private record Pending(String taskId, String projectId, List<String> scanners, Runnable task) {}
}
