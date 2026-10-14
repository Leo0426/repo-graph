package com.repograph.core.securityreview;

import java.util.List;

/**
 * 威胁检测请求。
 *
 * @param logs              待检测日志文件集合（名称 + 原文内容）
 * @param outboundWhitelist 允许的外联目标列表；元素为 IPv4 地址或 CIDR 网段（如 {@code 10.0.0.0/8}），
 *                          非 IP 字符串按原文精确匹配
 * @author leolu
 */
public record ThreatDetectionRequest(List<ThreatDetectionLog> logs, List<String> outboundWhitelist) {

    /**
     * 紧凑构造器：null 集合归一为空列表。
     */
    public ThreatDetectionRequest {
        logs = logs == null ? List.of() : List.copyOf(logs);
        outboundWhitelist = outboundWhitelist == null ? List.of() : List.copyOf(outboundWhitelist);
    }

    /**
     * 待检测日志文件。
     *
     * @param name    文件名（如 {@code auth.log}），用于报告定位
     * @param content 日志原文
     */
    public record ThreatDetectionLog(String name, String content) {
    }
}
