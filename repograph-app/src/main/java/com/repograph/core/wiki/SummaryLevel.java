package com.repograph.core.wiki;

/**
 * 分层摘要的级别。
 *
 * @author leolu
 * @since 0.7.0
 */
public enum SummaryLevel {

    /** 项目级架构摘要，scopeId 固定为 {@code "__project__"}。 */
    PROJECT,

    /** 包级子摘要，scopeId 为完整包名。 */
    PACKAGE
}
