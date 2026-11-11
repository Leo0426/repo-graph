package com.repograph.wiki;

import com.repograph.core.wiki.WikiModelException;
import com.repograph.modelprovider.ModelHttpFixture;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Wiki adapter contract through real settings and HTTP for each generation protocol. @author leolu */
class OllamaWikiSummaryModelTest {
    @TempDir Path temporary;

    @ParameterizedTest
    @ValueSource(strings = {"OLLAMA", "OPENAI", "ANTHROPIC"})
    void selectedProviderReturnsWikiContent(String protocol) throws Exception {
        try (var fixture = new ModelHttpFixture(temporary, protocol)) {
            fixture.text("正文");
            var model = new OllamaWikiSummaryModel(fixture.gateway);
            assertThat(model.available()).isTrue();
            assertThat(model.model()).isEqualTo("test-model");
            assertThat(model.complete("sys", "user")).isEqualTo("正文");
            assertThat(fixture.requests.get()).isEqualTo(1);
        }
    }

    @Test
    void disabledProviderMakesNoHttpRequest() throws Exception {
        try (var fixture = new ModelHttpFixture(temporary, "OPENAI")) {
            fixture.disable();
            var model = new OllamaWikiSummaryModel(fixture.gateway);
            assertThat(model.available()).isFalse();
            assertThat(model.model()).isEmpty();
            assertThatThrownBy(() -> model.complete("sys", "user")).isInstanceOf(WikiModelException.class);
            assertThat(fixture.requests.get()).isZero();
        }
    }

    @Test
    void httpFailureExposesOnlySafeStatus() throws Exception {
        try (var fixture = new ModelHttpFixture(temporary, "ANTHROPIC")) {
            fixture.raw(502, "sensitive source and provider secret");
            var model = new OllamaWikiSummaryModel(fixture.gateway);
            assertThatThrownBy(() -> model.complete("sys", "user"))
                    .isInstanceOf(WikiModelException.class).hasMessageContaining("HTTP 502")
                    .satisfies(error -> assertThat(error.getMessage()).doesNotContain("sensitive source"));
        }
    }
}
