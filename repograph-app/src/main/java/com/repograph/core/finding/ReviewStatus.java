package com.repograph.core.finding;

/**
 * 审核队列条目的状态机：{@code PENDING -> IN_REVIEW -> CONFIRMED / REJECTED}，
 * {@code IN_REVIEW} 也可退回 {@code PENDING} 重新排队。
 *
 * @author leolu
 */
public enum ReviewStatus {

    /** 已提交，尚未被认领。 */
    PENDING,

    /** 已被认领，正在人工复核。 */
    IN_REVIEW,

    /** 人工确认为真实风险。 */
    CONFIRMED,

    /** 人工驳回（判定为误报或不适用）。 */
    REJECTED
}
