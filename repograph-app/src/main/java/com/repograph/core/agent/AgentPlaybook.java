package com.repograph.core.agent;

/**
 * 平台可执行的版本化 Agent 工作流类型。
 *
 * @author leolu
 */
public enum AgentPlaybook {

    /** 外部 SAST 报警的证据化研判工作流。 */
    SAST_TRIAGE,

    /** 分层摘要生成工作流（结构卡 + LLM 架构摘要）。 */
    WIKI_SUMMARY
}
