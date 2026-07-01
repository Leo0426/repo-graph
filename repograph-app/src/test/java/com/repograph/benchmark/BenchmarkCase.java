package com.repograph.benchmark;

import java.util.List;

/**
 * 单条 benchmark 用例：一个查询 + 相关性判断模式 + 检索类型。
 *
 * <p>相关性判断：检索结果 {@code qualifiedName} 中只要含有 {@code expectedPatterns}
 * 中的 <b>任意一个</b>模式（大小写不敏感）即视为 hit。
 *
 * @param id               用例编号，如 {@code "S01"}、{@code "C03"}
 * @param description      简短描述，用于报告标题
 * @param query            实际发送给检索接口的查询字符串
 * @param type             检索类型：SEMANTIC（自然语言→代码）或 CODE（代码→代码）
 * @param expectedPatterns 相关代码单元的 qualifiedName 子串列表（任一匹配即 hit）
 */
record BenchmarkCase(
        String id,
        String description,
        String query,
        Type type,
        List<String> expectedPatterns
) {
    enum Type { SEMANTIC, CODE }
}
