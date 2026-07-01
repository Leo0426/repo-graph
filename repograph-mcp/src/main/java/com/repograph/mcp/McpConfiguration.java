package com.repograph.mcp;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * repograph-mcp Spring 配置：提供共享 Bean。
 *
 * <p>repograph-mcp 使用 {@code spring-boot-starter}（非 web），Jackson ObjectMapper
 * 不会被自动配置，需在此手动注册。
 *
 * @author leolu
 * @since 0.1.0
 */
@Configuration
public class McpConfiguration {

    /**
     * 共享 ObjectMapper，关闭未知属性失败（容忍 repograph-app 未来新增字段）。
     *
     * @return 配置好的 ObjectMapper 实例
     */
    @Bean
    public ObjectMapper objectMapper() {
        return new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                .configure(SerializationFeature.FAIL_ON_EMPTY_BEANS, false);
    }
}
