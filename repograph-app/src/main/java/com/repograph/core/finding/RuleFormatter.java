package com.repograph.core.finding;

/**
 * 将同一个规则版本导出为外部工具格式，不改变规则状态或执行扫描。
 *
 * @author leolu
 */
public interface RuleFormatter {

    /**
     * 生成包含单条规则的完整 Semgrep YAML 文档。
     * REGEX 目标为 PCRE2，使用前需在目标 Semgrep 版本验证 Java 正则的兼容性。
     *
     * @param rule 已注册的规则版本
     * @return 确定性的 YAML 文本
     */
    String toSemgrepYaml(DetectionRule rule);

    /**
     * 生成带原始 matcher 的 source-sink JSON；当前规则没有 source 定义，sources 固定为空。
     *
     * @param rule 已注册的规则版本
     * @return 确定性的 JSON 文本
     */
    String toSourceSinkJson(DetectionRule rule);
}
