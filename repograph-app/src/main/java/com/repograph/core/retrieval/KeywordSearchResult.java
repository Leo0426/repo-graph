package com.repograph.core.retrieval;

import com.repograph.core.model.CodeUnit;

import java.util.List;

/**
 * 关键词检索结果，包含命中的代码单元、归一化分数和命中词。
 *
 * @param unit         命中的代码单元
 * @param score        归一化关键词分数，范围约为 [0, 1]
 * @param matchedTerms 查询中命中的词
 * @author leolu
 */
public record KeywordSearchResult(
        CodeUnit unit,
        float score,
        List<String> matchedTerms
) {}
