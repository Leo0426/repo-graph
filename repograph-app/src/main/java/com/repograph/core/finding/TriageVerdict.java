package com.repograph.core.finding;

/**
 * 外部报警研判结论。
 *
 * @author leolu
 */
public enum TriageVerdict {

    /** 证据支持这是真实风险。 */
    TRUE_RISK,

    /** 证据倾向误报，如报警代码不可达或无安全敏感上下文。 */
    LIKELY_FALSE_POSITIVE,

    /** 证据不足以下结论，需要人工确认。 */
    NEEDS_REVIEW
}
