package com.repograph.benchmark;

import java.util.List;

/**
 * 单条 benchmark 用例的检索结果。
 *
 * @param benchCase  对应的 benchmark 用例
 * @param rank       第一个相关结果在返回列表中的排名（1-based）；0 表示未在 top-K 中找到
 * @param topScore   排名第 1 的结果的相似度分数（0 表示结果列表为空）
 * @param hitScore   第一个相关结果的相似度分数；未命中时为 0
 * @param retrieved  top-K 检索到的 qualifiedName 列表（顺序即 Qdrant 评分降序）
 */
record BenchmarkResult(
        BenchmarkCase benchCase,
        int rank,
        float topScore,
        float hitScore,
        List<String> retrieved
) {
    /** 第一个相关结果排名 ≤ k 则视为 hit。 */
    boolean hitAt(int k) { return rank >= 1 && rank <= k; }

    /** 倒数排名：命中时为 1/rank，否则为 0。 */
    double reciprocalRank() { return rank >= 1 ? 1.0 / rank : 0.0; }
}
