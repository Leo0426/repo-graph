package com.repograph.advisory;

import com.repograph.core.advisory.LlmAdvisoryAuditEvent;
import com.repograph.core.advisory.LlmAdvisoryAuditSink;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 仅记录请求元数据和资源消耗的 SLF4J 审计出口。
 *
 * @author leolu
 */
public class Slf4jLlmAdvisoryAuditSink implements LlmAdvisoryAuditSink {

    private static final Logger log = LoggerFactory.getLogger(Slf4jLlmAdvisoryAuditSink.class);

    /**
     * {@inheritDoc}
     */
    @Override
    public void record(LlmAdvisoryAuditEvent event) {
        log.info(
                "LLM advisory audit requestId={} fingerprint={} provider={} model={} status={} "
                        + "attempts={} latencyMs={} redactions={} inputTokens={} outputTokens={} "
                        + "costUsd={} errorCode={}",
                event.requestId(),
                event.findingFingerprint(),
                event.provider(),
                event.model(),
                event.status(),
                event.attempts(),
                event.latencyMs(),
                event.redactionCount(),
                event.usage().inputTokens(),
                event.usage().outputTokens(),
                event.usage().estimatedCostUsd(),
                event.errorCode());
    }
}
