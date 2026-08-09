package com.repograph.core.advisory;

/**
 * LLM 辅助复核运行时设置边界。
 *
 * @author leolu
 */
public interface LlmAdvisorySettingsService {

    /**
     * 读取当前有效设置。
     *
     * @return 当前设置
     */
    LlmAdvisorySettings current();

    /**
     * 更新并持久化当前设置。
     *
     * @param enabled   是否启用
     * @param baseUrl   Ollama HTTP 基础地址
     * @param model     Ollama 模型名称
     * @param updatedAt 更新时间，ISO-8601
     * @return 更新后的设置
     */
    LlmAdvisorySettings update(boolean enabled, String baseUrl, String model, String updatedAt);
}
