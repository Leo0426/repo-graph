package com.repograph.core.authorization;

/**
 * 鉴权约束候选的声明位置。
 *
 * @author leolu
 */
public enum AuthorizationScope {
    /** 控制器类型级约束。 */
    CLASS,
    /** 路由处理方法级约束。 */
    METHOD,
    /** Spring Security 过滤器链或其他配置级候选。 */
    CONFIGURATION
}
