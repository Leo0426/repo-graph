package com.repograph.metrics;

import java.util.List;

/**
 * 项目代码健康报告快照，聚合六个维度的指标数据。
 *
 * <p>健康分（healthScore）范围 [0, 100]，100 为满分，各维度按权重扣分：
 * <ul>
 *   <li>CRITICAL 漏洞 × 15（保留，当前扫描规则暂无该级别）</li>
 *   <li>HIGH 漏洞 × 10</li>
 *   <li>MEDIUM 漏洞 × 5</li>
 *   <li>LOW 漏洞 × 2</li>
 *   <li>包循环 × 10（每环，上限 −30）</li>
 *   <li>CC&gt;10 方法 × 2（上限 −20）</li>
 *   <li>高不稳定类（I&gt;0.8）× 1（上限 −10）</li>
 *   <li>测试空白率 &gt;70%：−15；&gt;50%：−10；&gt;30%：−5</li>
 *   <li>死代码率 &gt;10%：−5</li>
 * </ul>
 *
 * @param projectId               项目唯一标识符
 * @param projectRoot             项目根目录
 * @param generatedAt             生成时间（ISO-8601）
 * @param healthScore             综合健康分 [0,100]
 * @param totalUnits              代码单元总数
 * @param totalFiles              源文件总数
 * @param totalEdges              关系边总数
 * @param vulnCritical            CRITICAL 级别活跃漏洞数
 * @param vulnHigh                HIGH 级别活跃漏洞数
 * @param vulnMedium              MEDIUM 级别活跃漏洞数
 * @param vulnLow                 LOW 级别活跃漏洞数
 * @param packageCycles           包循环依赖数量
 * @param highComplexityMethods   CC &gt; 10 的方法数
 * @param highInstabilityClasses  不稳定性 &gt; 0.8 的类数
 * @param deadCodeCount           疑似死代码单元数
 * @param testGapCount            无测试覆盖路径的方法数
 * @param totalProductionMethods  生产方法总数（用于计算比率）
 * @param topComplexMethods       圈复杂度最高的前 5 个方法
 * @param topInstableCouplings    不稳定性最高的前 5 个类
 * @param packageCycleList        所有包循环（最多 10 个）
 * @author leolu
 * @since 0.6.0
 */
public record HealthReport(
        String projectId,
        String projectRoot,
        String generatedAt,
        int healthScore,

        long totalUnits,
        long totalFiles,
        long totalEdges,

        long vulnCritical,
        long vulnHigh,
        long vulnMedium,
        long vulnLow,

        int packageCycles,
        int highComplexityMethods,
        int highInstabilityClasses,
        long deadCodeCount,
        long testGapCount,
        long totalProductionMethods,

        List<ComplexityMetric> topComplexMethods,
        List<CouplingMetric> topInstableCouplings,
        List<PackageCycle> packageCycleList
) {}
