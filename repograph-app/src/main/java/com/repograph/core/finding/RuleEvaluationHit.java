package com.repograph.core.finding;

/**
 * 单条规则的一次命中事实：报警指纹与报警文件路径。文件路径用于抑制策略 FILE_GLOB 匹配，
 * 缺失时视为路径不可知、不参与抑制匹配。
 *
 * @param fingerprint 报警指纹（去重锚点）
 * @param filePath    报警文件相对路径，可能为 {@code null} 或空白
 * @author leolu
 */
public record RuleEvaluationHit(String fingerprint, String filePath) {

    public RuleEvaluationHit {
        if (fingerprint == null || fingerprint.isBlank()) {
            throw new IllegalArgumentException("fingerprint must not be blank");
        }
    }
}
