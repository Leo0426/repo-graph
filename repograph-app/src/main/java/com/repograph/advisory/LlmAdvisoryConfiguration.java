package com.repograph.advisory;

import com.repograph.core.advisory.LlmAdvisoryAuditSink;
import com.repograph.core.advisory.LlmAdvisoryModel;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

/**
 * LLM 辅助复核的默认安全配置。
 *
 * @author leolu
 */
@Configuration
public class LlmAdvisoryConfiguration {

    /**
     * 创建 Ollama 辅助复核专用 HTTP 客户端。
     *
     * @param builder    Spring HTTP 客户端构建器
     * @param properties 辅助复核超时边界
     * @return 有连接和读取超时的客户端
     */
    @Bean("llmAdvisoryRestTemplate")
    public RestTemplate llmAdvisoryRestTemplate(
            RestTemplateBuilder builder, LlmAdvisoryProperties properties) {
        Duration timeout = Duration.ofMillis(properties.timeoutMillis());
        return builder.connectTimeout(timeout).readTimeout(timeout).build();
    }

    /**
     * 在没有真实提供方适配器时注册关闭模型。
     *
     * @return 关闭模型
     */
    @Bean
    @ConditionalOnMissingBean(LlmAdvisoryModel.class)
    public LlmAdvisoryModel disabledLlmAdvisoryModel() {
        return new DisabledLlmAdvisoryModel();
    }

    /**
     * 注册不含提示词和源码的默认审计出口。
     *
     * @return SLF4J 审计出口
     */
    @Bean
    @ConditionalOnMissingBean(LlmAdvisoryAuditSink.class)
    public LlmAdvisoryAuditSink llmAdvisoryAuditSink() {
        return new Slf4jLlmAdvisoryAuditSink();
    }
}
