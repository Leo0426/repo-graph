package com.repograph.mcp;

import com.repograph.mcp.server.McpStdioServer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.Banner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

/**
 * RepoGraph MCP Server — Spring Boot 入口，以 stdio 方式实现 MCP 协议。
 *
 * <p>用法：
 * <pre>
 *   java -jar repograph-mcp-exec.jar [--base-url http://localhost:8080]
 * </pre>
 *
 * <p>MCP 客户端 mcpServers 配置示例：
 * <pre>
 * {
 *   "mcpServers": {
 *     "repograph": {
 *       "command": "java",
 *       "args": ["-jar", "/path/to/repograph-mcp-exec.jar",
 *                "--base-url", "http://localhost:8080"]
 *     }
 *   }
 * }
 * </pre>
 *
 * @author leolu
 * @since 0.1.0
 */
@SpringBootApplication
public class RepographMcpApplication {

    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(RepographMcpApplication.class);
        app.setBannerMode(Banner.Mode.OFF);
        app.setLogStartupInfo(false);
        app.run(args);
    }

    /**
     * 启动 MCP stdio 服务端主循环。
     *
     * <p>支持的命令行参数：{@code --base-url <url>}（也可通过 {@code REPOGRAPH_BASE_URL} 环境变量设置）。
     *
     * @param server      MCP stdio 服务端
     * @param defaultUrl  application.yml 中的默认 URL
     * @return Spring ApplicationRunner
     */
    @Bean
    public ApplicationRunner mcpRunner(McpStdioServer server,
                                       @Value("${repograph.base-url:http://localhost:8080}") String defaultUrl) {
        return (ApplicationArguments args) -> {
            String baseUrl = defaultUrl;
            // 支持 --base-url / -u 参数
            if (args.containsOption("base-url")) {
                var vals = args.getOptionValues("base-url");
                if (!vals.isEmpty()) baseUrl = vals.get(0);
            } else if (args.containsOption("u")) {
                var vals = args.getOptionValues("u");
                if (!vals.isEmpty()) baseUrl = vals.get(0);
            }
            // 支持 REPOGRAPH_BASE_URL 环境变量
            String envUrl = System.getenv("REPOGRAPH_BASE_URL");
            if (envUrl != null && !envUrl.isBlank()) baseUrl = envUrl;

            server.serve(baseUrl);
        };
    }
}
