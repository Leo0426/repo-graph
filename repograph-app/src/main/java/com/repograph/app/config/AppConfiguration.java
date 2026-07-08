package com.repograph.app.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 应用模块 Spring 配置，激活索引管道属性绑定。
 *
 * <p>{@code QdrantProperties} 和 {@code OllamaProperties} 由 {@code repograph-vector} 模块的
 * {@code VectorConfiguration} 负责激活，无需在此重复声明。
 *
 * @author leolu
 * @since 0.1.0
 */
@Configuration
@EnableConfigurationProperties({IndexProperties.class, com.repograph.vuln.PreciseTaintProperties.class})
public class AppConfiguration {}
