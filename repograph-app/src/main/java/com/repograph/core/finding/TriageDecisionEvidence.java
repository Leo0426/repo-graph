package com.repograph.core.finding;

/**
 * 参与自动研判决策的非源码证据及来源。
 *
 * @param source    证据来源，如 HISTORICAL_FEEDBACK、RULE_SUPPRESSION 或 PATH_PROTECTION
 * @param reference 来源内稳定引用，如报警指纹或策略 ID
 * @param summary   面向审核人的证据摘要
 * @param applied   该证据是否实际改变了本次自动结论
 * @author leolu
 */
public record TriageDecisionEvidence(
        String source,
        String reference,
        String summary,
        boolean applied
) {}
