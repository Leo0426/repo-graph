package com.repograph.vector.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Qdrant 向量库连接配置，绑定前缀 {@code repograph.qdrant}。
 *
 * @param host       Qdrant 服务主机名，默认 {@code localhost}
 * @param port       Qdrant gRPC 端口，默认 {@code 16333}
 * @param collection 向量集合名称，默认 {@code code_units}
 * @param vectorSize 向量维度，与 Embedding 模型输出维度一致，默认 {@code 768}
 * @author leolu
 * @since 0.1.0
 */
@ConfigurationProperties(prefix = "repograph.qdrant")
public record QdrantProperties(
        String host,
        int port,
        String collection,
        int vectorSize
) {}
