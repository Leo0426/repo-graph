package com.repograph.core.pipeline;

import java.nio.file.Path;

/**
 * 代码索引管道接口，编排文件扫描、解析、图构建、Embedding 和向量写入的完整流程。
 *
 * <p>流程顺序（不可打乱）：
 * <ol>
 *   <li>扫描文件（按扩展名分语言）</li>
 *   <li>增量过滤（文件 MD5 缓存）</li>
 *   <li>并行解析（产出 CodeUnit + RelationEdge）</li>
 *   <li>元数据增强（框架识别、入口点标记、测试标记）</li>
 *   <li>图构建（CodeUnit + RelationEdge → Neo4j）</li>
 *   <li>批量 Embedding（semantic_vec + code_vec）</li>
 *   <li>批量写入 Qdrant</li>
 *   <li>SBOM 提取（Maven pom.xml）</li>
 * </ol>
 *
 * @author leolu
 * @since 0.1.0
 */
public interface IndexPipeline {

    /**
     * 对指定项目根目录执行完整索引流程。
     *
     * @param projectRoot 项目根目录，必须是已存在的目录路径，不为 {@code null}
     * @param options     索引选项，{@code null} 时使用 {@link IndexOptions#defaults()}
     * @return 索引结果统计，包含文件数、符号数、边数、耗时和错误摘要；不为 {@code null}
     */
    IndexResult index(Path projectRoot, IndexOptions options);

    /**
     * 对单个文件执行增量索引，先清除该文件的旧图数据，再解析、embed 并写入向量库。
     *
     * <p>适用于文件保存后的实时增量更新场景，比全量 {@code index()} 更轻量。
     * 图和增量缓存在操作完成后同步更新。
     *
     * @param file        待索引的源文件路径，必须存在且可读，不为 {@code null}
     * @param projectRoot 项目根目录，用于计算相对路径和 projectId，不为 {@code null}
     * @param options     索引选项，{@code null} 时使用 {@link IndexOptions#defaults()}
     * @return 索引结果统计；不为 {@code null}
     */
    IndexResult indexFile(Path file, Path projectRoot, IndexOptions options);
}
