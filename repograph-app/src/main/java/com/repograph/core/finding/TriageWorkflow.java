package com.repograph.core.finding;

import java.io.InputStream;
import java.util.List;

/**
 * 共享研判流程；阶段分开以便 Agent 记录时间线，HTTP 和审核入口复用同一决策策略。
 *
 * @author leolu
 */
public interface TriageWorkflow {
    /**
     * 归一化外部报警并限制数量。
     * @param format 报警格式
     * @param input JSON 输入流，由调用方管理
     * @param maxFindings 请求数量上限，服务端限制为 1–50
     * @return 归一化报警
     */
    List<ExternalFinding> importFindings(String format, InputStream input, int maxFindings);

    /**
     * 构建项目范围内的报警上下文。
     * @param finding 外部报警
     * @param options 项目与预算
     * @return 研判证据
     */
    FindingContext buildContext(ExternalFinding finding, TriageOptions options);

    /**
     * 加载当前历史反馈和有效抑制，生成启发式报告，不改变漏洞状态。
     * @param context 通过 buildContext 构建的证据
     * @param options 同一次研判的项目与版本
     * @return 研判报告
     */
    TriageReport review(FindingContext context, TriageOptions options);
}
