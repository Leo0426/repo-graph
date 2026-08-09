package com.repograph.advisory;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link LlmAdvisorySettingsStore} 运行时设置持久化行为测试。
 *
 * @author leolu
 */
class LlmAdvisorySettingsStoreTest {

    @TempDir
    Path tempDir;

    @Test
    void pageSettingsOverrideYamlDefaultsAndSurviveRestart() {
        String dbPath = tempDir.resolve("settings.db").toString();
        LlmAdvisorySettingsStore first = new LlmAdvisorySettingsStore(
                dbPath, false, "http://localhost:11434", "qwen3:8b");

        assertThat(first.current()).satisfies(settings -> {
            assertThat(settings.enabled()).isFalse();
            assertThat(settings.provider()).isEqualTo("OLLAMA");
            assertThat(settings.model()).isEqualTo("qwen3:8b");
        });

        first.update(true, "http://127.0.0.1:11434/", "qwen3:14b", "2026-08-09T09:00:00Z");
        LlmAdvisorySettingsStore reopened = new LlmAdvisorySettingsStore(
                dbPath, false, "http://localhost:11434", "ignored-default");

        assertThat(reopened.current()).satisfies(settings -> {
            assertThat(settings.enabled()).isTrue();
            assertThat(settings.baseUrl()).isEqualTo("http://127.0.0.1:11434");
            assertThat(settings.model()).isEqualTo("qwen3:14b");
            assertThat(settings.updatedAt()).isEqualTo("2026-08-09T09:00:00Z");
        });
    }

    @Test
    void rejectsUnsafeOrIncompleteEndpointSettings() {
        LlmAdvisorySettingsStore store = new LlmAdvisorySettingsStore(
                tempDir.resolve("settings.db").toString(),
                false, "http://localhost:11434", "qwen3:8b");

        assertThatThrownBy(() -> store.update(
                true, "file:///etc/passwd", "qwen3:8b", "2026-08-09T09:00:00Z"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("HTTP");
        assertThatThrownBy(() -> store.update(
                true, "http://user:secret@localhost:11434", "", "2026-08-09T09:00:00Z"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
