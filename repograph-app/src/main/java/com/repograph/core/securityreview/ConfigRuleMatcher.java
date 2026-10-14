package com.repograph.core.securityreview;

/**
 * 配置核查规则的匹配器规格。
 *
 * <p>匹配器在按行解析出的 key-value 配置行上求值：
 * <ul>
 *   <li>{@link MatcherType#PRESENT}：键必须存在；若提供 {@code valuePattern}，值还必须匹配。</li>
 *   <li>{@link MatcherType#VALUE_PATTERN}：键的值必须匹配（{@code negate=true} 时必须不匹配）正则。</li>
 *   <li>{@link MatcherType#FORBIDDEN}：键不得处于启用状态（值为 yes/on/1/true/enabled）。</li>
 * </ul>
 *
 * @param type         匹配器类型
 * @param key          待核查的配置键，精确匹配
 * @param valuePattern 值正则，可选；PRESENT 判合规、VALUE_PATTERN 判命中
 * @param negate       仅 VALUE_PATTERN 使用：true 表示值命中正则即为违规
 * @author leolu
 */
public record ConfigRuleMatcher(MatcherType type, String key, String valuePattern, boolean negate) {

    /** 匹配器类型。 */
    public enum MatcherType {
        /** 键必须存在，可选地值必须匹配 {@code valuePattern}。 */
        PRESENT,
        /** 键的值必须匹配（或 negate 时不得匹配）{@code valuePattern}。 */
        VALUE_PATTERN,
        /** 键不得处于启用状态。 */
        FORBIDDEN
    }

    /**
     * 创建匹配器。
     *
     * @param type         匹配器类型
     * @param key          配置键
     * @param valuePattern 值正则，可为 null
     * @param negate       是否取反
     */
    public ConfigRuleMatcher {
    }
}
