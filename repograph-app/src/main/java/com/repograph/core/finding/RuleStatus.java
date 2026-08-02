package com.repograph.core.finding;

/**
 * 检测规则版本的生命周期状态。
 *
 * @author leolu
 */
public enum RuleStatus {
    CANDIDATE,
    IN_REVIEW,
    PUBLISHED,
    REJECTED,
    ROLLED_BACK
}
