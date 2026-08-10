package com.repograph.core.architecture;

import java.util.List;

/**
 * 一项可执行的架构深化候选。
 *
 * @param priority    优先级，1 为最高
 * @param title       候选标题
 * @param location    涉及位置
 * @param problem     当前复杂度表现
 * @param suggestion  改进建议
 * @param benefit     预期收益
 * @param cost        实施代价
 * @param risk        主要风险
 * @param methodology ForgeFlow 方法论映射
 * @param citations   支撑建议的证据 ID
 * @author leolu
 */
public record ArchitectureReviewCandidate(
        int priority,
        String title,
        String location,
        String problem,
        String suggestion,
        String benefit,
        String cost,
        String risk,
        String methodology,
        List<String> citations) {
}
