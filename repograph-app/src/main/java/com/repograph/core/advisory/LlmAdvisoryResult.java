package com.repograph.core.advisory;

import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;

import java.util.List;

/**
 * LLM 辅助复核结果。
 *
 * <p>该结果始终携带原始启发式报告并声明 {@code advisoryOnly=true}。
 * 模型建议不能改变漏洞状态，只能作为人工复核输入。
 *
 * @param heuristicReport 原始启发式报告
 * @param status          受控执行状态
 * @param modelUsed       是否实际调用模型
 * @param advisoryOnly    是否仅供参考，固定为 {@code true}
 * @param provider        模型提供方；未调用时为空
 * @param model           模型名称；未调用时为空
 * @param suggestedVerdict 模型建议结论；没有可信建议时为空
 * @param uncertainty     模型声明的不确定度 [0, 1]
 * @param citations       经输入白名单校验的 citation ID
 * @param missingInfo     模型或执行边界指出的缺失信息
 * @param redactionCount  输入脱敏替换次数
 * @param attempts        模型调用尝试次数
 * @param latencyMs       总耗时毫秒数
 * @param usage           token 与成本摘要
 * @author leolu
 */
public record LlmAdvisoryResult(
        TriageReport heuristicReport,
        LlmAdvisoryStatus status,
        boolean modelUsed,
        boolean advisoryOnly,
        String provider,
        String model,
        TriageVerdict suggestedVerdict,
        float uncertainty,
        List<String> citations,
        List<String> missingInfo,
        int redactionCount,
        int attempts,
        long latencyMs,
        LlmUsage usage
) {
    /**
     * 创建不可变辅助复核结果。
     */
    public LlmAdvisoryResult {
        if (!advisoryOnly) {
            throw new IllegalArgumentException("LLM review must be advisory only");
        }
        if (uncertainty < 0.0f || uncertainty > 1.0f) {
            throw new IllegalArgumentException("uncertainty must be between 0 and 1");
        }
        provider = provider == null ? "" : provider;
        model = model == null ? "" : model;
        citations = List.copyOf(citations);
        missingInfo = List.copyOf(missingInfo);
        usage = usage == null ? LlmUsage.NONE : usage;
    }

    /**
     * 生成未启用模型时的安全退化结果。
     *
     * @param report 原始启发式报告
     * @return 不含模型建议的结果
     */
    public static LlmAdvisoryResult disabled(TriageReport report) {
        return new LlmAdvisoryResult(
                report,
                LlmAdvisoryStatus.DISABLED,
                false,
                true,
                "",
                "",
                null,
                1.0f,
                List.of(),
                List.of("LLM 辅助复核未启用，当前仅返回启发式研判结果"),
                0,
                0,
                0L,
                LlmUsage.NONE);
    }
}
