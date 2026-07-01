package com.repograph.graph;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Neo4j 连接配置，绑定前缀 {@code repograph.neo4j}。
 *
 * @param uri      Bolt URI，如 {@code bolt://localhost:7687}
 * @param user     用户名，默认 Neo4j 安装时的 {@code neo4j}
 * @param password 密码，必须显式配置（Neo4j 默认会强制首次登录修改）
 * @author leolu
 * @since 0.2.0
 */
@ConfigurationProperties(prefix = "repograph.neo4j")
public record Neo4jProperties(
        String uri,
        String user,
        String password
) {}
