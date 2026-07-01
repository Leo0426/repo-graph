package com.repograph.core.vector;

import com.repograph.core.model.CodeUnit;

import java.util.List;

import java.util.Optional;

/**
 * 向量存储接口，管理代码单元的双向量 upsert 和多维度检索。
 *
 * <p>每个 {@link CodeUnit} 在存储时携带两个向量：
 * {@code semantic}（注释 + 签名，用于 NL→代码检索）和 {@code code}（rawSource，用于代码相似检索）。
 *
 * @author leolu
 * @since 0.1.0
 */
public interface VectorStore {

    /**
     * 批量写入或更新代码单元及其双向量。
     *
     * <p>每个 {@link EmbeddedUnit} 封装一个代码单元和它的两个向量，避免调用方维护三个并行列表。
     * 已存在的 ID 执行更新，不存在则插入。
     *
     * @param units     持有代码单元和双向量的列表，不为 {@code null}
     * @param projectId 所属项目 ID，写入 payload 用于过滤
     */
    void upsert(List<EmbeddedUnit> units, String projectId);

    /**
     * 基于自然语言查询进行语义检索，使用 {@code semantic} 向量。
     *
     * @param nlQuery 自然语言查询字符串，不为 {@code null}
     * @param opts    检索选项，{@code null} 时使用 {@link SearchOptions#defaults()}
     * @return 分页检索结果，含 {@code hasMore} 提示；无匹配时结果列表为空
     */
    SearchPage semanticSearch(String nlQuery, SearchOptions opts);

    /**
     * 基于代码片段进行相似代码检索，使用 {@code code} 向量。
     *
     * @param codeSnippet 代码片段字符串，不为 {@code null}
     * @param opts        检索选项，{@code null} 时使用 {@link SearchOptions#defaults()}
     * @return 分页检索结果，含 {@code hasMore} 提示；无匹配时结果列表为空
     */
    SearchPage codeSearch(String codeSnippet, SearchOptions opts);

    /**
     * 删除指定文件路径在指定项目下的所有向量点，用于增量重新索引前清理过时数据。
     *
     * <p>通过 {@code file_path} 和 {@code project_id} payload 过滤定位并删除点。
     * 文件未索引时幂等返回，不报错。
     *
     * @param filePath  文件相对路径，不为 {@code null}
     * @param projectId 所属项目 ID，不为 {@code null}
     */
    void removeByFile(String filePath, String projectId);

    /**
     * 删除指定项目下的所有向量点，用于项目级清理（删除整个项目的索引）。
     *
     * <p>通过 {@code project_id} payload 过滤定位并删除。项目无数据时幂等返回，不报错。
     *
     * @param projectId 所属项目 ID，不为 {@code null}
     */
    void removeByProject(String projectId);

    /**
     * 按全限定名精确查找代码单元。
     *
     * @param qualifiedName 全限定名，不为 {@code null}
     * @return 匹配的 {@link CodeUnit}；不存在时返回 {@link Optional#empty()}
     */
    Optional<CodeUnit> symbolLookup(String qualifiedName);

    /**
     * 按文件路径和行号定位代码单元，返回包含指定行的最小粒度符号。
     *
     * @param filePath 文件相对路径，不为 {@code null}
     * @param line     目标行号，1-based
     * @return 包含该行的 {@link CodeUnit}；不存在时返回 {@link Optional#empty()}
     */
    Optional<CodeUnit> locateByPosition(String filePath, int line);
}
