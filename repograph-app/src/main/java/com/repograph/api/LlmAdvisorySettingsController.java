package com.repograph.api;

import com.repograph.advisory.LlmAdvisorySettingsStore;
import com.repograph.advisory.OllamaConnectionStatus;
import com.repograph.advisory.OllamaLlmAdvisoryModel;
import com.repograph.core.advisory.LlmAdvisorySettings;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;

/**
 * Agent 工作台的 LLM 辅助复核运行时设置 API。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/agent-settings/llm")
public class LlmAdvisorySettingsController {

    private final LlmAdvisorySettingsStore settingsStore;
    private final OllamaLlmAdvisoryModel ollamaModel;
    private final Clock clock;

    /**
     * 创建 LLM 设置控制器。
     *
     * @param settingsStore 运行时设置存储
     * @param ollamaModel   Ollama 模型适配器
     * @param clock         更新时间时钟
     */
    public LlmAdvisorySettingsController(
            LlmAdvisorySettingsStore settingsStore,
            OllamaLlmAdvisoryModel ollamaModel,
            @Qualifier("agentClock") Clock clock) {
        this.settingsStore = settingsStore;
        this.ollamaModel = ollamaModel;
        this.clock = clock;
    }

    /**
     * 读取当前有效的 LLM 设置。
     *
     * @return 当前运行时设置
     */
    @GetMapping
    public LlmAdvisorySettings get() {
        return settingsStore.current();
    }

    /**
     * 保存页面 LLM 设置，后续 Agent Run 立即使用。
     *
     * @param request 页面设置
     * @return 保存后的规范化设置
     */
    @PutMapping
    public LlmAdvisorySettings update(@RequestBody LlmSettingsRequest request) {
        return settingsStore.update(
                request.enabled(), request.baseUrl(), request.model(), clock.instant().toString());
    }

    /**
     * 使用页面草稿值检测 Ollama 和目标模型，不修改已保存设置。
     *
     * @param request 页面设置草稿
     * @return 连接和模型检测结果
     */
    @PostMapping("/test")
    public OllamaConnectionStatus test(@RequestBody LlmSettingsRequest request) {
        return ollamaModel.testConnection(request.baseUrl(), request.model());
    }

    /**
     * 页面提交的 Ollama 辅助复核设置。
     *
     * @param enabled 是否启用
     * @param baseUrl Ollama HTTP 基础地址
     * @param model   生成模型名称
     */
    public record LlmSettingsRequest(boolean enabled, String baseUrl, String model) {
    }
}
