package com.repograph.app.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 索引管道运行时参数配置，绑定前缀 {@code repograph.index}。
 *
 * @param dbPath          SQLite 增量缓存数据库文件路径，默认 {@code ${user.home}/.repograph/index.db}
 * @param batchSize       批处理大小配置，含 embed 和 upsert 两个维度
 * @param defaultStrategy 默认解析策略，取值 {@code AUTO}、{@code PRECISE} 或 {@code HEURISTIC}
 * @author leolu
 * @since 0.1.0
 */
@ConfigurationProperties(prefix = "repograph.index")
public record IndexProperties(
        String dbPath,
        BatchSize batchSize,
        String defaultStrategy
) {

    /**
     * 批处理大小与并发配置。
     *
     * @param embed       Embedding 批大小，建议不超过 32
     * @param upsert      Qdrant upsert 批大小，建议不超过 256
     * @param parallelism 并发 embedding batch 数；线程池大小为 {@code 2 × parallelism}（
     *                    每个 batch 同时发送 semantic + code 两路请求）；默认 4
     */
    public record BatchSize(int embed, int upsert, int parallelism) {}
}
