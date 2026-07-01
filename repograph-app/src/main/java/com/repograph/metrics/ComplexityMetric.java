package com.repograph.metrics;

/**
 * 单个代码单元的圈复杂度度量结果。
 *
 * @param qualifiedName 符号全限定名
 * @param filePath      相对文件路径
 * @param startLine     起始行号
 * @param kind          符号类型（METHOD / FUNCTION / CONSTRUCTOR）
 * @param complexity    圈复杂度近似值（≥1，决策点数 + 1）
 * @author leolu
 * @since 0.6.0
 */
public record ComplexityMetric(
        String qualifiedName,
        String filePath,
        int startLine,
        String kind,
        int complexity
) {}
