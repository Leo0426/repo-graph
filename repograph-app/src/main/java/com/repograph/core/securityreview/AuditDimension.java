package com.repograph.core.securityreview;

/**
 * 安全审查分系统的核查/检测维度。
 *
 * <p>维度覆盖装备网络安全试验符合性检查中的安全策略、主机安全、系统配置和系统日志四类对象。
 * 规则集按维度组织，某维度没有可用规则集时不参与核查，也不出现在报告中。
 *
 * @author leolu
 */
public enum AuditDimension {

    /** 安全策略：口令策略、远程登录策略等访问控制策略配置。 */
    SECURITY_POLICY,

    /** 主机安全基线：SSH 服务参数、口令复用与空闲会话等主机加固配置。 */
    HOST_BASELINE,

    /** 系统配置：内核参数、网络参数等系统级安全配置。 */
    SYSTEM_CONFIG,

    /** 系统日志：日志守护进程的采集、轮转与留存规范性配置。 */
    SYSTEM_LOG
}
