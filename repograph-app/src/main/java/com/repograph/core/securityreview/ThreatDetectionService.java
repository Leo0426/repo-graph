package com.repograph.core.securityreview;

/**
 * 威胁检测服务接口。
 *
 * <p>输入为调用方提供的日志内容与外联白名单，输出为结构化威胁检测报告；
 * 服务无状态，报告按需生成不持久化。
 *
 * @author leolu
 */
public interface ThreatDetectionService {

    /**
     * 对给定日志执行威胁检测。
     *
     * @param request 检测请求（日志 + 白名单）
     * @return 威胁检测报告
     */
    ThreatReport detect(ThreatDetectionRequest request);
}
