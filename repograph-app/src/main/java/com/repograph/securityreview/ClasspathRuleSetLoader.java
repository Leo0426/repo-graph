package com.repograph.securityreview;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;

/**
 * classpath JSON 规则集加载器。
 *
 * <p>按 location pattern（如 {@code classpath*:security-review/rules/*.json}）加载全部规则文件并
 * 反序列化为类型化规则列表。规则即数据：新增规则文件不需要修改任何引擎代码。
 *
 * @param <T> 规则类型
 * @author leolu
 */
final class ClasspathRuleSetLoader<T> {

    private final ObjectMapper objectMapper;
    private final Class<T> ruleType;

    /**
     * 创建加载器。
     *
     * @param ruleType 规则反序列化目标类型
     */
    ClasspathRuleSetLoader(Class<T> ruleType) {
        this.objectMapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        this.ruleType = ruleType;
    }

    /**
     * 加载 location pattern 匹配的全部规则文件。
     *
     * @param locationPattern classpath location pattern
     * @return 规则列表；无匹配文件时为空列表
     * @throws UncheckedIOException 规则文件读取或解析失败时抛出，规则损坏必须显式失败而不是静默跳过
     */
    List<T> load(String locationPattern) {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        List<T> rules = new ArrayList<>();
        try {
            for (Resource resource : resolver.getResources(locationPattern)) {
                try (var in = resource.getInputStream()) {
                    Object array = objectMapper.readValue(
                            in, objectMapper.getTypeFactory().constructArrayType(ruleType));
                    for (Object rule : (Object[]) array) {
                        rules.add(ruleType.cast(rule));
                    }
                }
            }
        } catch (IOException error) {
            throw new UncheckedIOException("加载安全审查规则集失败: " + locationPattern, error);
        }
        return List.copyOf(rules);
    }
}
