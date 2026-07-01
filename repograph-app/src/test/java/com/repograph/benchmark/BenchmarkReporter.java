package com.repograph.benchmark;

import java.util.List;

/**
 * 将 benchmark 结果格式化为人类可读的文本报告，并打印到 stdout。
 *
 * <p>报告包含三部分：
 * <ol>
 *   <li>逐条结果表（查询 · @1/@3/@5/@10 hit · 命中排名 · 命中分数）</li>
 *   <li>聚合指标：Hit@1/3/5/10、MRR@K、平均 top-1 相似度</li>
 *   <li>未命中用例详情（包括 top-1 实际召回的结果及其分数）</li>
 * </ol>
 *
 * <p>Score 列显示命中结果的分数（{@code hitScore}），未命中时为 0.000。
 * 这比显示 top-1 分数更能反映检索质量：rank=1 时两者相同；rank>1 时 hitScore 更低，
 * 直观体现该模型在目标结果上的置信度。
 */
final class BenchmarkReporter {

    private static final int[] KS = {1, 3, 5, 10};
    private static final int DESC_WIDTH = 50;

    private BenchmarkReporter() {}

    static void print(String title, List<BenchmarkResult> results, int k) {
        System.out.println();
        System.out.println("── " + title + " (" + results.size() + " queries, K=" + k + ") " + "─".repeat(40));
        printHeader();
        results.forEach(r -> printRow(r, k));
        System.out.println("  " + "─".repeat(82));
        printAggregate(results, k);
        printMisses(results, k);
    }

    // ── private helpers ────────────────────────────────────────────

    private static void printHeader() {
        System.out.printf("  %-4s  %-" + DESC_WIDTH + "s  %3s %3s %3s %3s  %4s  %9s%n",
                "ID", "Query / Description", "@1", "@3", "@5", "10", "Rank", "HitScore");
        System.out.println("  " + "─".repeat(82));
    }

    private static void printRow(BenchmarkResult r, int k) {
        String q = r.benchCase().description();
        if (q.length() > DESC_WIDTH) q = q.substring(0, DESC_WIDTH - 1) + "…";
        System.out.printf("  %-4s  %-" + DESC_WIDTH + "s  %3s %3s %3s %3s  %4s  %9.3f%n",
                r.benchCase().id(),
                q,
                mark(r, 1), mark(r, 3), mark(r, 5), mark(r, 10),
                r.rank() > 0 ? String.valueOf(r.rank()) : "—",
                r.hitScore());
    }

    private static String mark(BenchmarkResult r, int k) {
        return r.hitAt(k) ? "✓" : "✗";
    }

    private static void printAggregate(List<BenchmarkResult> results, int k) {
        System.out.print(" ");
        for (int ki : KS) {
            long hits = results.stream().filter(r -> r.hitAt(ki)).count();
            System.out.printf("  Hit@%-2d %5.1f%%", ki, 100.0 * hits / results.size());
        }
        System.out.println();

        double mrr = results.stream().mapToDouble(BenchmarkResult::reciprocalRank).average().orElse(0);
        double avgTop1 = results.stream().mapToDouble(BenchmarkResult::topScore).average().orElse(0);
        System.out.printf("  MRR@%-2d %.3f    Avg top-1 score %.3f%n%n", k, mrr, avgTop1);
    }

    private static void printMisses(List<BenchmarkResult> results, int k) {
        List<BenchmarkResult> misses = results.stream().filter(r -> !r.hitAt(k)).toList();
        if (misses.isEmpty()) return;
        System.out.println("  Misses (rank > " + k + " or not found):");
        for (BenchmarkResult m : misses) {
            System.out.printf("    %s  \"%s\"%n", m.benchCase().id(), m.benchCase().query());
            System.out.printf("       expected : %s%n", m.benchCase().expectedPatterns());
            if (!m.retrieved().isEmpty()) {
                System.out.printf("       top-1    : %s  (score=%.3f)%n",
                        m.retrieved().get(0), m.topScore());
            } else {
                System.out.println("       top-1    : (no results returned)");
            }
        }
        System.out.println();
    }
}
