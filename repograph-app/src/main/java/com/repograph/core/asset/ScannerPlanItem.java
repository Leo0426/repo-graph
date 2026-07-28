package com.repograph.core.asset;

/**
 * 单个扫描器的推荐决策。
 *
 * @param scanner  扫描器标识
 * @param selected 是否选择
 * @param source   决策来源
 * @param reason   自动适用性说明
 * @author leolu
 */
public record ScannerPlanItem(
        String scanner,
        boolean selected,
        String source,
        String reason
) {}
