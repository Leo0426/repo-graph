package com.repograph.core.authorization;

/**
 * 路由鉴权证据状态。
 *
 * <p>状态只描述当前静态证据强度，不代表端点已确认安全或未鉴权。
 *
 * @author leolu
 */
public enum AuthorizationEvidenceStatus {
    /** 找到控制器类或方法上的本地鉴权约束候选。 */
    LOCAL_CONSTRAINT_CANDIDATE,
    /** 找到过滤器链或安全配置候选，但无法静态确认其覆盖当前路由。 */
    POLICY_CANDIDATE,
    /** 未找到本地鉴权证据，不能据此确认端点未鉴权。 */
    NO_LOCAL_EVIDENCE,
    /**
     * 已由运行时验证或人工证据确认端点允许未鉴权访问。
     *
     * <p>当前静态分析服务不会自动产生该状态。
     */
    CONFIRMED_UNAUTHENTICATED
}
