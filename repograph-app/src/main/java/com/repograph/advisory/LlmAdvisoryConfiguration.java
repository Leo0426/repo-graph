package com.repograph.advisory;

import com.repograph.core.advisory.LlmAdvisoryAuditSink;
import com.repograph.core.advisory.LlmAdvisoryModel;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * LLM 辅助复核的默认安全配置。
 *
 * @author leolu
 */
@Configuration
public class LlmAdvisoryConfiguration {

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
