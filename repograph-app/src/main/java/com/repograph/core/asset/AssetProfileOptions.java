package com.repograph.core.asset;

import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 资产画像生成选项。
 *
 * @param includeScanners 强制包含的扫描器
 * @param excludeScanners 强制排除的扫描器；与包含列表冲突时排除优先
 * @author leolu
 */
public record AssetProfileOptions(
        Set<String> includeScanners,
        Set<String> excludeScanners
) {
    /**
     * 规范化扫描器名称并创建不可变选项。
     */
    public AssetProfileOptions {
        includeScanners = normalize(includeScanners);
        excludeScanners = normalize(excludeScanners);
    }

    /**
     * 返回无人工覆盖的默认选项。
     *
     * @return 默认选项
     */
    public static AssetProfileOptions defaults() {
        return new AssetProfileOptions(Set.of(), Set.of());
    }

    private static Set<String> normalize(Set<String> scanners) {
        if (scanners == null) {
            return Set.of();
        }
        return scanners.stream()
                .filter(value -> value != null && !value.isBlank())
                .map(value -> value.trim().toUpperCase(Locale.ROOT))
                .collect(Collectors.toUnmodifiableSet());
    }
}
