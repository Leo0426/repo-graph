package com.repograph.core.advisory;

/**
 * LLM 辅助复核审计事件出口。
 *
 * @author leolu
 */
public interface LlmAdvisoryAuditSink {

    /**
     * 记录不含提示词和源码的审计元数据。
     *
     * @param event 审计事件
     */
    void record(LlmAdvisoryAuditEvent event);
}
