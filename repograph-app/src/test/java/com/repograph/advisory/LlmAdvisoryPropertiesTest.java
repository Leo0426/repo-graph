package com.repograph.advisory;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link LlmAdvisoryProperties} 默认运行边界测试。
 *
 * @author leolu
 */
class LlmAdvisoryPropertiesTest {

    @Test
    void defaultsAllowLocalStructuredReviewWithoutDuplicateTimeoutRetry() {
        LlmAdvisoryProperties properties = LlmAdvisoryProperties.defaults();

        assertThat(properties.timeoutMillis()).isEqualTo(180_000L);
        assertThat(properties.maxRetries()).isZero();
    }
}
