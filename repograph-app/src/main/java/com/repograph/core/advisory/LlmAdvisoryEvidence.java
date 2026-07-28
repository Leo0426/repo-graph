package com.repograph.core.advisory;

/**
 * 发送给模型的受限证据片段。
 *
 * @param citationId citation ID
 * @param location   文件与行号位置
 * @param excerpt    经预算裁剪和脱敏后的片段
 * @param untrusted  是否必须按不可信数据处理，固定为 {@code true}
 * @author leolu
 */
public record LlmAdvisoryEvidence(
        String citationId,
        String location,
        String excerpt,
        boolean untrusted
) {
    /**
     * 创建不可信证据。
     */
    public LlmAdvisoryEvidence {
        if (!untrusted) {
            throw new IllegalArgumentException("model evidence must be marked as untrusted");
        }
    }
}
