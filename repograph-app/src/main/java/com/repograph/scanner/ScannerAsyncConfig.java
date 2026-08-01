package com.repograph.scanner;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * 异步扫描任务执行 executor 配置。
 *
 * <p>T10-1 使用有界固定线程池；全局/项目/扫描器级并发配额调度在 T10-3 引入，届时替换本 bean。
 *
 * @author leolu
 */
@Configuration
public class ScannerAsyncConfig {

    /**
     * 扫描任务执行 executor。
     *
     * @param poolSize      工作线程数
     * @param queueCapacity 等待队列容量
     * @return executor
     */
    @Bean("scanTaskExecutor")
    public Executor scanTaskExecutor(
            @Value("${repograph.scanner.tasks.pool-size:2}") int poolSize,
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
