package com.repograph.wiki;

import java.util.List;

/**
 * 单个包的确定性结构事实，全部来自图查询，不含模型生成内容。
 *
 * @param pkg             完整包名；无包结构的顶层符号（C 函数、JS 顶层函数）为 {@code (root)}
 * @param unitCount       包内可检索单元数
 * @param entryPointCount 标记 is_entry_point 的单元数
 * @param inboundCalls    被其他包调用的次数（跨包 CALLS 边入度，按类边聚合）
 * @param outboundCalls   调用其他包的次数（跨包 CALLS 边出度）
 * @param keySymbols      按入度排序的关键类全限定名（最多 5 个），无跨包调用时为包内类名
 * @author leolu
 * @since 0.7.0
 */
public record PackageFacts(
        String pkg,
        int unitCount,
        int entryPointCount,
        int inboundCalls,
        int outboundCalls,
        List<String> keySymbols
) {

    /** 无包结构符号的分组名。 */
    public static final String ROOT_PACKAGE = "(root)";

    public PackageFacts {
        if (pkg == null || pkg.isEmpty()) pkg = ROOT_PACKAGE;
        if (keySymbols == null) keySymbols = List.of();
        keySymbols = List.copyOf(keySymbols);
    }
}
