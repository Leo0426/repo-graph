package com.repograph.app.config;

import jakarta.servlet.MultipartConfigElement;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.MultipartConfigFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.unit.DataSize;

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

    private static final class ArchiveRequestOverhead {
        private static final long BYTES = 1024L * 1024L;

        private ArchiveRequestOverhead() {}
    }
}
