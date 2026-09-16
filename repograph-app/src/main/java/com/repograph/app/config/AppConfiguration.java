package com.repograph.app.config;

import jakarta.servlet.MultipartConfigElement;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.MultipartConfigFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.unit.DataSize;

import java.time.Clock;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 应用模块 Spring 配置，激活索引管道属性绑定。
 *
 * <p>{@code QdrantProperties} 和 {@code OllamaProperties} 由 {@code repograph-vector} 模块的
 * {@code VectorConfiguration} 负责激活，无需在此重复声明。
 *
 * @author leolu
 * @since 0.1.0
 */
@Configuration
@EnableConfigurationProperties({
        IndexProperties.class,
        com.repograph.asset.ArchiveProperties.class,
        com.repograph.scanner.ScannerProperties.class,
        com.repograph.advisory.LlmAdvisoryProperties.class
})
public class AppConfiguration {

    /**
     * 让 Servlet multipart 传输上限与归档业务上限保持一致。
     *
     * @param properties 归档安全配置
     * @return Servlet multipart 配置
     */
    @Bean
    public MultipartConfigElement multipartConfigElement(com.repograph.asset.ArchiveProperties properties) {
        MultipartConfigFactory factory = new MultipartConfigFactory();
        factory.setMaxFileSize(DataSize.ofBytes(properties.maxUploadBytes()));
        factory.setMaxRequestSize(DataSize.ofBytes(
                Math.addExact(properties.maxUploadBytes(), ArchiveRequestOverhead.BYTES)));
        return factory.createMultipartConfig();
    }

    /**
     * 归档资产后台索引专用单线程执行器。
     *
     * @return 后台索引执行器
     */
    @Bean(name = "assetIndexExecutor", destroyMethod = "shutdown")
    public ExecutorService assetIndexExecutor() {
        return Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "repograph-asset-index");
            thread.setDaemon(true);
            return thread;
        });
    }

    /**
     * LLM 辅助复核专用单线程执行器，用于强制单次调用超时和隔离重试。
     *
     * @return 辅助复核执行器
     */
    @Bean(name = "llmAdvisoryExecutor", destroyMethod = "shutdown")
    public ExecutorService llmAdvisoryExecutor() {
        return Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "repograph-llm-advisory");
            thread.setDaemon(true);
            return thread;
        });
    }

    /**
     * 架构评审流式任务专用单线程执行器，避免长连接占用辅助复核的超时隔离线程。
     *
     * @return 架构评审执行器
     */
    @Bean(name = "architectureReviewExecutor", destroyMethod = "shutdown")
    public ExecutorService architectureReviewExecutor() {
        return Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "repograph-architecture-review");
            thread.setDaemon(true);
            return thread;
        });
    }

    /**
     * Agent Playbook 后台执行专用单线程执行器，保证单实例内运行顺序可审计。
     *
     * @param capacity 等待队列容量
     * @return Agent 运行执行器
     */
    @Bean(name = "agentRunExecutor", destroyMethod = "shutdown")
    public ExecutorService agentRunExecutor(
            @org.springframework.beans.factory.annotation.Value("${repograph.agent.queue-capacity:128}") int capacity) {
        return taskExecutor("repograph-agent-run", capacity);
    }

    /**
     * 创建有界项目索引执行器。
     * @param capacity 等待队列容量
     * @return 由 Spring 关闭的执行器
     */
    @Bean(name = "indexExecutor", destroyMethod = "shutdown")
    public ExecutorService indexExecutor(
            @org.springframework.beans.factory.annotation.Value("${repograph.index.queue-capacity:128}") int capacity) {
        return taskExecutor("repograph-index", capacity);
    }

    private static ExecutorService taskExecutor(String name, int capacity) {
        return new java.util.concurrent.ThreadPoolExecutor(1, 1, 0, java.util.concurrent.TimeUnit.MILLISECONDS,
                new java.util.concurrent.ArrayBlockingQueue<>(Math.max(1, capacity)), runnable -> {
                    Thread thread = new Thread(runnable, name);
                    thread.setDaemon(true);
                    return thread;
                }, new java.util.concurrent.ThreadPoolExecutor.AbortPolicy());
    }

    /**
     * Agent 运行时间戳使用的 UTC 时钟。
     *
     * @return UTC 系统时钟
     */
    @Bean(name = "agentClock")
    public Clock agentClock() {
        return Clock.systemUTC();
    }

    private static final class ArchiveRequestOverhead {
        private static final long BYTES = 1024L * 1024L;

        private ArchiveRequestOverhead() {}
    }
}
