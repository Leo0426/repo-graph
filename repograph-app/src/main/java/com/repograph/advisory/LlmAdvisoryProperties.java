package com.repograph.advisory;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 受约束 LLM 辅助复核配置。
 *
 * @param enabled             是否启用
 * @param maxInputChars       最大输入字符数
 * @param maxOutputChars      最大输出字符数
 * @param maxEstimatedCostUsd 单次最大估算美元成本
 * @param timeoutMillis       单次尝试超时毫秒数
 * @param maxRetries          最大重试次数
 * @param redact              是否启用秘密信息脱敏
 * @author leolu
 */
@ConfigurationProperties(prefix = "repograph.advisory")
public record LlmAdvisoryProperties(
        boolean enabled,
        int maxInputChars,
        int maxOutputChars,
        double maxEstimatedCostUsd,
        long timeoutMillis,
        int maxRetries,
        boolean redact
) {
    /**
     * 创建并校验配置。
     */
    public LlmAdvisoryProperties {
        if (maxInputChars <= 0 || maxOutputChars <= 0 || timeoutMillis <= 0L || maxRetries < 0) {
            throw new IllegalArgumentException("LLM advisory limits must be positive");
        }
        if (maxEstimatedCostUsd < 0.0d) {
            throw new IllegalArgumentException("maxEstimatedCostUsd must not be negative");
        }
    }

    /**
     * 返回安全默认配置。
     *
     * @return 默认关闭的配置
     */
    public static LlmAdvisoryProperties defaults() {
        return new LlmAdvisoryProperties(false, 12_000, 4_000, 0.05d, 15_000L, 1, true);
    }
}
