package com.repograph.core.authorization;

/**
 * 从注解或安全配置中提取的鉴权约束候选。
 *
 * @param scope      声明位置
 * @param annotation 注解或配置类型
 * @param expression principal、role、authority 或策略表达式
 * @param effective  是否为当前静态合并规则下的有效本地候选；不代表运行时一定生效
 * @param citation   源码引用
 * @author leolu
 */
public record AuthorizationConstraint(
        AuthorizationScope scope,
        String annotation,
        String expression,
        boolean effective,
        SourceCitation citation
) {}
