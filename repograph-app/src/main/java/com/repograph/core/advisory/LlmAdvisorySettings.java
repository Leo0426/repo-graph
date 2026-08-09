package com.repograph.core.advisory;

/**
 * LLM 辅助复核的运行时连接设置。
 *
 * @param enabled   是否启用辅助复核
 * @param provider  模型提供方
 * @param baseUrl   提供方 HTTP 基础地址
 * @param model     模型名称
 * @param updatedAt 最后更新时间，ISO-8601
 * @author leolu
 */
public record LlmAdvisorySettings(
        boolean enabled,
        String provider,
        String baseUrl,
        String model,
        String updatedAt) {
}
