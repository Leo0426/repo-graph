package com.repograph.core.advisory;

import com.repograph.core.finding.TriageReport;

/**
 * LLM 辅助复核领域接口。
 *
 * @author leolu
 */
public interface LlmAdvisoryService {

    /**
     * 基于已有启发式报告生成仅供人工参考的建议。
     *
     * @param heuristicReport 启发式报告
     * @return 受控辅助复核结果
     */
    LlmAdvisoryResult review(TriageReport heuristicReport);
}
