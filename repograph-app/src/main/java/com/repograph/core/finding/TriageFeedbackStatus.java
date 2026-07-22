package com.repograph.core.finding;

import java.util.Locale;

/**
 * 用户对研判结果的反馈状态。
 *
 * @author leolu
 */
public enum TriageFeedbackStatus {

    /** 人工确认为真实漏洞。 */
    TRUE_POSITIVE,

    /** 人工确认为误报。 */
    FALSE_POSITIVE,

    /** 仍需人工复核。 */
    NEEDS_REVIEW,

    /** 已修复。 */
    FIXED;

    /**
     * 解析状态字符串，大小写不敏感。
     *
     * @param value 状态字符串
     * @return 对应状态
     * @throws IllegalArgumentException 状态非法时给出合法值列表
     */
    public static TriageFeedbackStatus parse(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(
                    "status must be one of TRUE_POSITIVE, FALSE_POSITIVE, NEEDS_REVIEW, FIXED");
        }
        try {
            return valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("invalid status '" + value
                    + "', must be one of TRUE_POSITIVE, FALSE_POSITIVE, NEEDS_REVIEW, FIXED");
        }
    }
}
