package com.repograph.scanner;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * 异步扫描任务执行 executor 配置。
 *
 * <p>并发准入由 {@link ScanTaskScheduler} 按全局/项目/扫描器配额控制；本 executor 只负责执行被准入的
 * 任务，线程数应 ≥ 全局配额（{@code repograph.scanner.quota.global}），使被准入任务立即获得线程。
 *
 * @author leolu
 */
@Configuration
public class ScannerAsyncConfig {

    /**
     * 扫描任务执行 executor。
     *
     * @param poolSize      工作线程数，应 ≥ 全局并发配额
     * @param queueCapacity 等待队列容量
     * @return executor
     */
    @Bean("scanTaskExecutor")
    public Executor scanTaskExecutor(
            @Value("${repograph.scanner.tasks.pool-size:8}") int poolSize,
            @Value("${repograph.scanner.tasks.queue-capacity:1000}") int queueCapacity) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setThreadNamePrefix("scan-task-");
        executor.setCorePoolSize(poolSize);
        executor.setMaxPoolSize(poolSize);
        executor.setQueueCapacity(queueCapacity);
        executor.initialize();
        return executor;
    }
}
