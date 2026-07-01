package com.repograph.metrics;

/**
 * 类级别耦合度度量结果（Robert Martin 传入/传出耦合）。
 *
 * <ul>
 *   <li><b>fanIn（传入耦合 / Ca）</b>：有多少外部类调用了本类的方法。值越高表示本类越被依赖，改动风险越大。</li>
 *   <li><b>fanOut（传出耦合 / Ce）</b>：本类调用了多少外部类。值越高表示本类越不稳定、依赖越多。</li>
 *   <li><b>instability（不稳定性 / I）</b>：{@code Ce / (Ca + Ce)}，范围 [0, 1]。
 *       0 表示高度稳定（只被别人依赖），1 表示高度不稳定（只依赖别人）。</li>
 * </ul>
 *
 * @param classQualifiedName 类的全限定名
 * @param fanIn              传入耦合：依赖本类的外部类数
 * @param fanOut             传出耦合：本类依赖的外部类数
 * @param instability        不稳定性系数，{@code fanOut / (fanIn + fanOut)}
 * @author leolu
 * @since 0.6.0
 */
public record CouplingMetric(
        String classQualifiedName,
        int fanIn,
        int fanOut,
        double instability
) {}
