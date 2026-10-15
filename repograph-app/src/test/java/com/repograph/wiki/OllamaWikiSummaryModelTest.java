package com.repograph.wiki;

import com.repograph.core.advisory.LlmAdvisorySettings;
import com.repograph.core.advisory.LlmAdvisorySettingsService;
import com.repograph.core.wiki.WikiModelException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * {@link OllamaWikiSummaryModel} 单元测试。
 *
 * @author leolu
 * @since 0.7.0
 */
@ExtendWith(MockitoExtension.class)
class OllamaWikiSummaryModelTest {

    @Mock
    LlmAdvisorySettingsService settingsService;

    @Mock
    RestTemplate restTemplate;

    private OllamaWikiSummaryModel model() {
        return new OllamaWikiSummaryModel(settingsService, restTemplate);
    }

    private static LlmAdvisorySettings settings(boolean enabled) {
        return new LlmAdvisorySettings(enabled, "OLLAMA", "http://localhost:11434",
                "test-model", "2026-10-15T10:00:00Z");
    }

    @Test
    void available_requiresEnabledSettings() {
        when(settingsService.current()).thenReturn(settings(false));

        assertThat(model().available()).isFalse();
        assertThat(model().model()).isEmpty();
    }

    @Test
    void complete_returnsContent() {
        when(settingsService.current()).thenReturn(settings(true));
        when(restTemplate.postForObject(
                eq("http://localhost:11434/api/chat"),
                any(HttpEntity.class),
                eq(OllamaWikiSummaryModel.ChatResponse.class)))
                .thenReturn(new OllamaWikiSummaryModel.ChatResponse(
                        new OllamaWikiSummaryModel.Message("assistant", "正文")));

        assertThat(model().complete("sys", "user")).isEqualTo("正文");
    }

    @Test
    void complete_httpError_throwsWikiModelException() {
        when(settingsService.current()).thenReturn(settings(true));
        when(restTemplate.postForObject(
                anyString(), any(HttpEntity.class),
                eq(OllamaWikiSummaryModel.ChatResponse.class)))
                .thenThrow(new RestClientResponseException("boom",
                        HttpStatus.BAD_GATEWAY.value(), "Bad Gateway", null, null, null));

        assertThatThrownBy(() -> model().complete("sys", "user"))
                .isInstanceOf(WikiModelException.class)
                .hasMessageContaining("HTTP 502");
    }

    @Test
    void complete_disabled_throwsWithoutHttpCall() {
        when(settingsService.current()).thenReturn(settings(false));

        assertThatThrownBy(() -> model().complete("sys", "user"))
                .isInstanceOf(WikiModelException.class);
    }
}
