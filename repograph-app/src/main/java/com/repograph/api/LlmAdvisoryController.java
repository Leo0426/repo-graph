package com.repograph.api;

import com.repograph.core.advisory.LlmAdvisoryResult;
import com.repograph.core.advisory.LlmAdvisoryService;
import com.repograph.core.finding.TriageReport;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * LLM 辅助复核 REST 入口。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/triage")
public class LlmAdvisoryController {

    private final LlmAdvisoryService advisoryService;

    /**
     * 创建辅助复核控制器。
     *
     * @param advisoryService 辅助复核领域边界
     */
    public LlmAdvisoryController(LlmAdvisoryService advisoryService) {
        this.advisoryService = advisoryService;
    }

    /**
     * 对已有启发式报告生成仅供人工参考的模型建议。
     *
     * @param heuristicReport 启发式报告
     * @return 不会改变原报告或漏洞状态的辅助复核结果
     */
    @PostMapping("/advisory")
    public LlmAdvisoryResult review(@RequestBody TriageReport heuristicReport) {
        return advisoryService.review(heuristicReport);
    }
}
