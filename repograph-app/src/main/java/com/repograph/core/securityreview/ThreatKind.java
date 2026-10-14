package com.repograph.core.securityreview;

/**
 * 在役装备威胁类型。
 *
 * @author leolu
 */
public enum ThreatKind {

    /** 被攻击历史：登录失败、暴力破解、探测扫描等攻击痕迹。 */
    ATTACK_HISTORY,

    /** 违规外联：连向白名单之外外部地址的出站连接记录。 */
    VIOLATION_OUTBOUND
}
