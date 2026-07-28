package com.repograph.core.advisory;

/**
 * 不含提示词和源码的 LLM 辅助复核审计事件。
 *
 * @param requestId          请求 ID
 * @param findingFingerprint 报警指纹
 * @param provider           模型提供方
 * @param model              模型名称
 * @param status             结果状态
 * @param attempts           尝试次数
 * @param latencyMs          总耗时
 * @param redactionCount     脱敏替换次数
 * @param usage              token 与成本摘要
 * @param errorCode          安全错误码，不含异常原文
 * @param occurredAt         UTC 时间
 * @author leolu
 */
public record LlmAdvisoryAuditEvent(
        String requestId,
        String findingFingerprint,
        String provider,
        String model,
        LlmAdvisoryStatus status,
        int attempts,
        long latencyMs,
        int redactionCount,
        LlmUsage usage,
        String errorCode,
        String occurredAt
) {}
