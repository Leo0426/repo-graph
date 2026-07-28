package com.repograph.core.finding;

/**
 * 规则抑制的作用域。
 *
 * @author leolu
 */
public enum RuleSuppressionScope {
    /** 对项目内该规则的全部报警生效。 */
    PROJECT,
    /** 仅对 scopeValue glob 匹配的项目相对文件生效。 */
    FILE_GLOB
}
