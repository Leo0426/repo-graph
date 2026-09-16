package com.repograph.core.finding;

/**
 * 所有研判入口共用的项目、版本与上下文预算。
 *
 * @param projectId 项目范围；空字符串表示兼容全局查询
 * @param codeVersion 代码版本
 * @param ruleVersion 规则版本
 * @param budgetChars 单条报警的源码字符预算
 * @author leolu
 */
public record TriageOptions(String projectId, String codeVersion, String ruleVersion, int budgetChars) {
    /** 创建并归一化研判选项。 */
    public TriageOptions {
        projectId = projectId == null ? "" : projectId.trim();
        codeVersion = codeVersion == null ? "" : codeVersion.trim();
        ruleVersion = ruleVersion == null ? "" : ruleVersion.trim();
        budgetChars = Math.max(1000, Math.min(budgetChars, 60000));
    }
}
