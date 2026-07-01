package com.repograph.app;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Spring Boot 应用入口，扫描所有 {@code com.repograph} 包下的组件。
 *
 * <p>CLI 命令通过 Picocli Spring Boot Starter 集成，{@code @Command} bean 由 Spring 管理并支持依赖注入。
 * 运行 {@code repograph serve} 时启动内嵌 Web 服务器；其他子命令执行完毕后退出。
 *
 * @author leolu
 * @since 0.1.0
 */
@SpringBootApplication(scanBasePackages = "com.repograph")
public class RepographApplication {

    /**
     * 应用启动入口。
     *
     * @param args 命令行参数，由 Picocli 解析为对应子命令
     */
    public static void main(String[] args) {
        SpringApplication.run(RepographApplication.class, args);
    }
}
