package com.repograph.api;

import com.repograph.advisory.LlmAdvisorySettingsStore;
import com.repograph.advisory.OllamaConnectionStatus;
import com.repograph.advisory.OllamaLlmAdvisoryModel;
import com.repograph.core.advisory.LlmAdvisorySettings;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link LlmAdvisorySettingsController} 页面设置 REST 契约测试。
 *
 * @author leolu
 */
@WebMvcTest(LlmAdvisorySettingsController.class)
class LlmAdvisorySettingsControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    LlmAdvisorySettingsStore settingsStore;

    @MockitoBean
    OllamaLlmAdvisoryModel ollamaModel;

    @MockitoBean(name = "agentClock")
    Clock clock;

    @Test
    void getAndUpdateExposeRuntimeSettingsWithoutRestart() throws Exception {
        LlmAdvisorySettings disabled = settings(false, "qwen3:8b");
        LlmAdvisorySettings enabled = settings(true, "qwen3:14b");
        when(settingsStore.current()).thenReturn(disabled);
        when(clock.instant()).thenReturn(Instant.parse("2026-08-09T10:00:00Z"));
        when(settingsStore.update(
                true, "http://localhost:11434", "qwen3:14b", "2026-08-09T10:00:00Z"))
                .thenReturn(enabled);

        mvc.perform(get("/api/v1/agent-settings/llm"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.provider").value("OLLAMA"));

        mvc.perform(put("/api/v1/agent-settings/llm")
                        .contentType("application/json")
                        .content("""
                                {"enabled":true,"baseUrl":"http://localhost:11434","model":"qwen3:14b"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.model").value("qwen3:14b"));
    }

    @Test
    void testEndpointChecksDraftConnectionSettingsBeforeSaving() throws Exception {
        when(ollamaModel.testConnection("http://localhost:11434", "qwen3:8b"))
                .thenReturn(new OllamaConnectionStatus(
                        true, true, "Ollama connected; target model is available", List.of("qwen3:8b")));

        mvc.perform(post("/api/v1/agent-settings/llm/test")
                        .contentType("application/json")
                        .content("""
                                {"enabled":true,"baseUrl":"http://localhost:11434","model":"qwen3:8b"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reachable").value(true))
                .andExpect(jsonPath("$.modelAvailable").value(true))
                .andExpect(jsonPath("$.models[0]").value("qwen3:8b"));
    }

    private static LlmAdvisorySettings settings(boolean enabled, String model) {
        return new LlmAdvisorySettings(
                enabled, "OLLAMA", "http://localhost:11434", model, "2026-08-09T10:00:00Z");
    }
}
