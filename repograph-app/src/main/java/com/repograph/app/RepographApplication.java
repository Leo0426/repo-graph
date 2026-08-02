package com.repograph.app;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Spring Boot 应用入口，扫描所有 {@code com.repograph} 包下的组件。
 *
 * <p>应用对外提供 Web、REST 和 MCP 接口；索引与分析操作统一通过这些接口触发。
 *
 * @author leolu
 * @since 0.1.0
 */
@SpringBootApplication(scanBasePackages = "com.repograph")
public class RepographApplication {

    /**
     * 应用启动入口。
     *
     * @param args Spring Boot 启动参数
     */
    public static void main(String[] args) {
        SpringApplication.run(RepographApplication.class, args);
    }
}
