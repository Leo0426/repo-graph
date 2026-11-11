package com.repograph.core.vector;

import com.repograph.core.model.CodeUnit;

/**
 * 向量检索的单条结果，包含匹配的代码单元及其相似度分数。
 *
 * @param unit  匹配到的代码单元，不为 {@code null}
 * @param score 余弦相似度分数，范围 [0, 1]，值越大表示越相似
 * @param projectId 匹配结果所属项目，跨仓库结果定位时使用；旧内部调用可为 {@code null}
 * @author leolu
 * @since 0.1.0
 */
public record SearchResult(CodeUnit unit, float score, String projectId) {
    /** 保留既有内部结果构造方式。 */
    public SearchResult(CodeUnit unit, float score) {
        this(unit, score, null);
    }
}
