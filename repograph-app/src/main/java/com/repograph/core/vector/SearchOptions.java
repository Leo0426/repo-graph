package com.repograph.core.vector;

import com.repograph.core.model.CodeUnitKind;

/**
 * 向量检索查询选项，支持按语言、符号类型、项目等维度过滤，以及分页控制。
 *
 * @param limit     每页最大返回结果数，正整数；默认为 10，服务端上限 100
 * @param offset    跳过前 N 条结果，用于翻页；默认为 0
 * @param language  按语言过滤（如 {@code "java"}），{@code null} 表示不过滤
 * @param kind      按符号类型过滤，{@code null} 表示不过滤
 * @param projectId 按项目 ID 过滤，{@code null} 表示不过滤
 * @param entryOnly 为 {@code true} 时仅返回入口点符号（{@code metadata["is_entry_point"]="true"}）
 * @param noTest    为 {@code true} 时排除测试代码（{@code metadata["is_test"]="true"}）
 * @author leolu
 * @since 0.1.0
 */
public record SearchOptions(
        int limit,
        int offset,
        String language,
        CodeUnitKind kind,
        String projectId,
        boolean entryOnly,
        boolean noTest
) {

    /**
     * 创建默认检索选项：返回前 10 条（offset=0），不过滤语言、类型和项目。
     *
     * @return 默认 {@link SearchOptions} 实例
     */
    public static SearchOptions defaults() {
        return new SearchOptions(10, 0, null, null, null, false, false);
    }
}
