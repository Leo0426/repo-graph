package com.repograph.metrics;

import com.repograph.core.graph.GraphDiagnosticsService;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * 圈复杂度（Cyclomatic Complexity）近似分析器。
 *
 * <p>基于 rawSource 字符串匹配统计决策点数量，公式：
 * <pre>CC = 1 + if + else if + for + while + do + case + catch + ternary (?) + && + ||</pre>
 *
 * <p>属于启发式估算，不解析 AST；对内联注释中的关键字可能产生少量误计，但对大多数
 * 生产代码偏差可接受。CC ≤ 5 为低风险，6-10 为中等，&gt; 10 建议重构。
 *
 * @author leolu
 * @since 0.6.0
 */
@Service
public class ComplexityAnalyzer {

    private final GraphDiagnosticsService graphDiagnosticsService;

    public ComplexityAnalyzer(GraphDiagnosticsService graphDiagnosticsService) {
        this.graphDiagnosticsService = graphDiagnosticsService;
    }

    /**
     * 返回指定项目圈复杂度最高的前 {@code limit} 个代码单元，按复杂度降序排列。
     *
     * @param projectId 项目 ID
     * @param limit     最大返回数量
     * @return 圈复杂度指标列表，按复杂度倒序；无数据时返回空列表
     */
    public List<ComplexityMetric> topComplex(String projectId, int limit) {
        return graphDiagnosticsService.listScanTargets(projectId).stream()
                .map(u -> new ComplexityMetric(
                        u.qualifiedName(),
                        u.filePath(),
                        u.startLine(),
                        u.kind().name(),
                        compute(u.rawSource())))
                .filter(m -> m.complexity() > 1)
                .sorted(Comparator.comparingInt(ComplexityMetric::complexity).reversed())
                .limit(limit)
                .toList();
    }

    /**
     * 计算单个方法源码的圈复杂度近似值。
     *
     * @param src 方法 rawSource，可为 {@code null} 或空白
     * @return 圈复杂度（最小值 1）
     */
    static int compute(String src) {
        if (src == null || src.isBlank()) return 1;
        String s = src.toLowerCase(Locale.ROOT);
        int cc = 1;
        cc += count(s, "if (")   + count(s, "if(");
        cc += count(s, "else if");
        cc += count(s, "for (")  + count(s, "for(");
        cc += count(s, "while (")+ count(s, "while(");
        cc += count(s, "do {")   + count(s, "do{");
        cc += count(s, "case ");
        cc += count(s, "catch (")+ count(s, "catch(");
        cc += count(s, " && ");
        cc += count(s, " || ");
        cc += count(s, " ? ");   // 三元运算符
        return cc;
    }

    private static int count(String src, String token) {
        int n = 0, idx = 0;
        while ((idx = src.indexOf(token, idx)) != -1) { n++; idx += token.length(); }
        return n;
    }
}
