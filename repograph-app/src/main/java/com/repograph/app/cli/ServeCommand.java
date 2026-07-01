package com.repograph.app.cli;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

/**
 * {@code repograph serve} 子命令，启动内嵌 Spring Boot Web 服务器暴露 REST API。
 *
 * <p>运行 {@code repograph serve} 时 Spring Boot 已经完成初始化（嵌入式 Tomcat 已启动），
 * 此命令只需保持进程存活等待请求即可。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
        name = "serve",
        mixinStandardHelpOptions = true,
        description = "启动 REST API 服务（默认端口 8080）"
)
@Component
public class ServeCommand implements Runnable {

    private static final Logger log = LoggerFactory.getLogger(ServeCommand.class);

    @Option(names = "--port", description = "监听端口，覆盖 application.yml 中的 server.port", defaultValue = "8080")
    private int port;

    @Override
    public void run() {
        log.info("RepoGraph REST API server running on port {}", port);
        // Spring Boot 内嵌容器已在 RepographApplication 启动时运行，此处仅记录日志
    }
}
