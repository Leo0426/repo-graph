package com.repograph.core.retrieval;

import com.repograph.core.model.CodeUnitKind;

/**
 * 关键词检索选项。
 *
 * @param limit     最大返回数量
 * @param language  可选语言过滤
 * @param kind      可选代码单元类型过滤
 * @param projectId 可选项目 ID
 * @param noTest    是否排除测试代码
 * @author leolu
 */
public record KeywordSearchOptions(
        int limit,
        String language,
        CodeUnitKind kind,
        String projectId,
        boolean noTest
) {
    /**
     * 默认关键词检索选项。
     *
     * @return 默认选项
     */
    public static KeywordSearchOptions defaults() {
        return new KeywordSearchOptions(10, null, null, null, true);
    }
}
