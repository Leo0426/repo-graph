package com.repograph.api;

import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 最小化 Spring Boot 配置，供 {@code @WebMvcTest} 切片测试发现 {@code @SpringBootConfiguration}。
 *
 * <p>仅用于测试；不作为生产入口点。
 *
 * @author leolu
 * @since 0.1.0
 */
@org.springframework.boot.test.context.TestComponent
@org.springframework.context.annotation.Import(ControllerTestSecurity.class)
@SpringBootApplication
class RepographApiTestApplication {
}
