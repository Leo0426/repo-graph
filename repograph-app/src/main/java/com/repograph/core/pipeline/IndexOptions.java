package com.repograph.core.pipeline;

import com.repograph.core.parser.ParseStrategy;

import java.util.List;

/**
 * 索引管道运行时选项，控制语言范围、解析策略和增量模式。
 *
 * @param languages   需要索引的语言列表（如 {@code ["java", "c", "python"]}）；
 *                    空列表表示索引所有受支持语言
 * @param strategy    解析策略，{@code null} 时使用 {@link ParseStrategy#AUTO}
 * @param incremental 为 {@code true} 时启用增量索引（基于文件 MD5 缓存跳过未变更文件）；
 *                    为 {@code false} 时强制全量重新索引
 * @param dbPath      SQLite 增量缓存数据库路径；{@code null} 时使用 {@code application.yml} 中的配置
 * @author leolu
 * @since 0.1.0
 */
public record IndexOptions(
        List<String> languages,
        ParseStrategy strategy,
        boolean incremental,
        String dbPath
) {

    /**
     * 创建默认索引选项：AUTO 策略，所有语言，启用增量索引，使用默认数据库路径。
     *
     * @return 默认 {@link IndexOptions} 实例
     */
    public static IndexOptions defaults() {
        return new IndexOptions(List.of(), ParseStrategy.AUTO, true, null);
    }
}
