package com.repograph.uipreview;

import com.repograph.api.ViewController;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 使用真实 Thymeleaf 模板与静态资源的隔离 UI 预览服务。
 *
 * <p>仅导入首页控制器，不扫描业务组件；数据库、索引、监听和扫描器不会启动。
 * 此文件由 UI 验证命令单独编译，不属于默认 Gradle 测试 sourceSet。
 *
 * @author leolu
 */
@Configuration(proxyBeanMethods = false)
@EnableAutoConfiguration(excludeName = {
        "org.springframework.boot.autoconfigure.neo4j.Neo4jAutoConfiguration",
        "org.springframework.boot.autoconfigure.data.neo4j.Neo4jDataAutoConfiguration",
        "org.springframework.boot.autoconfigure.data.neo4j.Neo4jRepositoriesAutoConfiguration",
        "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration",
        "org.springframework.boot.autoconfigure.jdbc.DataSourceTransactionManagerAutoConfiguration",
        "org.springframework.boot.autoconfigure.sql.init.SqlInitializationAutoConfiguration"
})
@Import(ViewController.class)
public class PreviewServer {

    /**
     * 启动隔离预览，地址和端口由独立 properties 或环境变量配置。
     *
     * @param args 额外的 Spring 命令行配置；模板和配置文件位置由预览服务指定
     * @throws IllegalStateException 缺少预览配置、模板或静态资源时抛出
     */
    public static void main(String[] args) {
        String configuredResources = System.getenv("UI_RESOURCES");
        Path resources = Path.of(configuredResources == null || configuredResources.isBlank()
                        ? "repograph-app/src/main/resources" : configuredResources)
                .toAbsolutePath().normalize();
        Path config = Path.of(System.getProperty("repograph.preview.config",
                        "repograph-app/src/test/ui/preview.properties"))
                .toAbsolutePath().normalize();
        if (!Files.isRegularFile(config) || !Files.isRegularFile(resources.resolve("templates/index.html"))
                || !Files.isDirectory(resources.resolve("static"))) {
            throw new IllegalStateException("Run from the repository root, or configure preview resources and config");
        }
        List<String> options = new ArrayList<>(Arrays.asList(args));
        options.addAll(List.of(
                "--spring.config.location=" + config.toUri(),
                "--spring.thymeleaf.prefix=" + resources.resolve("templates").toUri(),
                "--spring.web.resources.static-locations=" + resources.resolve("static").toUri()));
        SpringApplication application = new SpringApplication(PreviewServer.class);
        application.setWebApplicationType(WebApplicationType.SERVLET);
        ConfigurableApplicationContext context = application.run(options.toArray(String[]::new));
        if (context.getBeanNamesForType(ViewController.class).length != 1) {
            context.close();
            throw new IllegalStateException("The real ViewController must be registered exactly once");
        }
    }
}
