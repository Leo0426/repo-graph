package com.repograph.agent;

/**
 * 启动 SAST 研判 Agent 的输入命令。原始报警只用于本次执行，不写入 Agent 运行表。
 *
 * @param projectId   项目标识
 * @param format      外部报警格式
 * @param findingsJson 外部工具 JSON
 * @param codeVersion 代码版本
 * @param ruleVersion 规则版本
 * @param budgetChars 单条报警的上下文字符预算
 * @param maxFindings 最大处理报警数
 * @author leolu
 */
public record SastTriageAgentCommand(
        String projectId,
        String format,
        String findingsJson,
        String codeVersion,
        String ruleVersion,
        int budgetChars,
        int maxFindings) {
}
