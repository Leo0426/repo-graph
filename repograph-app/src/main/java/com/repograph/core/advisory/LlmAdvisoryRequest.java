package com.repograph.core.advisory;

import com.repograph.core.finding.TriageVerdict;

import java.util.List;

/**
 * 提供方中立的 LLM 辅助复核请求。
 *
 * <p>请求不包含外部报警的 raw 字段；证据均显式标记为不可信。
 * 模型适配器必须把它们放在与系统指令隔离的数据区中。
 *
 * @param requestId          请求 ID
 * @param findingFingerprint 报警指纹
 * @param heuristicVerdict   启发式结论
 * @param findingSummary     经脱敏的报警摘要
 * @param evidence           经预算裁剪和脱敏的证据
 * @param missingInfo        启发式报告已有缺失信息
 * @param maxOutputChars     最大输出字符数
 * @author leolu
 */
public record LlmAdvisoryRequest(
        String requestId,
        String findingFingerprint,
        TriageVerdict heuristicVerdict,
        String findingSummary,
        List<LlmAdvisoryEvidence> evidence,
        List<String> missingInfo,
        int maxOutputChars
) {
    /**
     * 创建不可变模型请求。
     */
    public LlmAdvisoryRequest {
        evidence = List.copyOf(evidence);
        missingInfo = List.copyOf(missingInfo);
    }
}
