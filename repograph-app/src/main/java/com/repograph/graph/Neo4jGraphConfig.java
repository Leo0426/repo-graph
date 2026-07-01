package com.repograph.graph;

import org.neo4j.driver.AuthTokens;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.neo4j.driver.Session;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * Neo4j 驱动 Bean 装配 + 启动时的约束/索引初始化。
 *
 * <p>{@link Driver} 是线程安全的重型对象，作为单例存活整个应用生命周期；查询时通过
 * 短期 {@link Session} 访问，{@code try-with-resources} 自动释放。
 *
 * <p>Bean 在初始化阶段验证连接并幂等地创建 {@code (:CodeUnit)} 标签的唯一性约束
 * 与常用属性的二级索引。Bean 销毁阶段关闭 Driver。
 *
 * @author leolu
 * @since 0.2.0
 */
@Configuration
@EnableConfigurationProperties(Neo4jProperties.class)
public class Neo4jGraphConfig {

    private static final Logger log = LoggerFactory.getLogger(Neo4jGraphConfig.class);

    private static final List<String> SCHEMA_STATEMENTS = List.of(
            "CREATE CONSTRAINT codeunit_id_unique IF NOT EXISTS FOR (n:CodeUnit) REQUIRE n.id IS UNIQUE",
            "CREATE INDEX codeunit_qn IF NOT EXISTS FOR (n:CodeUnit) ON (n.qualifiedName)",
            "CREATE INDEX codeunit_project IF NOT EXISTS FOR (n:CodeUnit) ON (n.projectId)",
            "CREATE INDEX codeunit_file IF NOT EXISTS FOR (n:CodeUnit) ON (n.filePath)",
            "CREATE INDEX codeunit_entrypoint IF NOT EXISTS FOR (n:CodeUnit) ON (n.is_entry_point)"
    );

    /**
     * 暴露 {@link Driver} 单例 Bean，{@code destroyMethod="close"} 确保 Spring 容器
     * 关闭时释放底层连接池。
     *
     * @param properties Neo4j 连接配置，{@code uri} 不能为空
     * @return 已就绪并完成 schema 初始化的 Driver
     */
    @Bean(destroyMethod = "close")
    public Driver neo4jDriver(Neo4jProperties properties) {
        if (properties.uri() == null || properties.uri().isBlank()) {
            throw new IllegalStateException(
                    "repograph.neo4j.uri is required (e.g. bolt://localhost:7687)");
        }
        Driver driver = GraphDatabase.driver(
                properties.uri(),
                AuthTokens.basic(properties.user(), properties.password()));
        driver.verifyConnectivity();
        log.info("Neo4j driver connected: {}", properties.uri());

        try (Session session = driver.session()) {
            for (String stmt : SCHEMA_STATEMENTS) {
                session.run(stmt).consume();
            }
        }
        log.info("Neo4j schema initialised ({} statements)", SCHEMA_STATEMENTS.size());
        return driver;
    }
}
