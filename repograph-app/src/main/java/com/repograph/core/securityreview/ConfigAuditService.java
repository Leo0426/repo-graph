package com.repograph.core.securityreview;

/**
 * 配置核查服务接口。
 *
 * <p>输入为调用方提供的配置文件内容，输出为结构化核查报告；服务无状态，报告按需生成不持久化。
 *
 * @author leolu
 */
public interface ConfigAuditService {

    /**
     * 对给定配置文件执行规则核查。
     *
     * @param request 核查请求（文件 + 维度过滤）
     * @return 核查报告
     */
    ConfigAuditReport audit(ConfigAuditRequest request);
}
