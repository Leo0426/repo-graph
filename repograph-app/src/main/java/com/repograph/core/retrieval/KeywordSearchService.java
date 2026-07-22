package com.repograph.core.retrieval;

import java.util.List;

/**
 * 关键词检索接口，用于补足向量检索对符号名、规则 ID、CVE/CWE、配置 key 的不稳定匹配。
 *
 * @author leolu
 */
public interface KeywordSearchService {

    /**
     * 执行关键词检索。
     *
     * @param query   查询字符串
     * @param options 检索选项；为空时使用默认值
     * @return 按关键词分数降序排列的结果
     */
    List<KeywordSearchResult> search(String query, KeywordSearchOptions options);
}
