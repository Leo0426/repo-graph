package com.repograph.retrieval;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.retrieval.GraphRagOptions;
import com.repograph.core.retrieval.GraphRagResult;
import com.repograph.core.retrieval.KeywordSearchOptions;
import com.repograph.core.retrieval.KeywordSearchResult;
import com.repograph.core.retrieval.KeywordSearchService;
import com.repograph.core.retrieval.RankedUnit;
import com.repograph.core.vector.SearchOptions;
import com.repograph.core.vector.SearchPage;
import com.repograph.core.vector.SearchResult;
import com.repograph.core.vector.VectorStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * GraphRAG 检索服务，将向量语义搜索与知识图谱展开和安全感知重排序融合为一条完整的检索管道：
 *
 * <ol>
 *   <li><b>Code Structure Chunking</b>：依赖索引阶段已做的语义文本增强（方法 Javadoc + 父类上下文）</li>
 *   <li><b>Call Graph Retrieval</b>：以向量种子为起点，沿 CALLS 边向上（callers）和向下（callees）展开</li>
 *   <li><b>Impact Expansion</b>：从种子执行影响面分析，仅补充安全相关节点</li>
 *   <li><b>Security-aware Rerank</b>：利用 {@link SecurityAwareReranker} 对所有结果评分并重排序</li>
 * </ol>
 *
 * @see GraphRagOptions
 * @see GraphRagResult
 * @author leolu
 */
@Service
public class GraphRagService {

    /** 每个种子节点最多展开的调用方/被调用方数量，防止结果集爆炸。 */
    private static final int MAX_EXPAND_PER_SEED = 20;

    /** 影响面扩展仅对前 N 个种子执行，控制 Neo4j 查询开销。 */
    private static final int MAX_SEEDS_FOR_IMPACT = 3;

    /** 每个种子最多从影响面分析结果中取的安全相关节点数。 */
    private static final int MAX_IMPACT_PER_SEED = 20;

    private final VectorStore vectorStore;
    private final GraphQueryService graphQueryService;
    private final SecurityAwareReranker reranker;
    private final KeywordSearchService keywordSearchService;

    /**
     * 创建 GraphRAG 检索服务。
     *
     * @param vectorStore      向量检索边界
     * @param graphQueryService 代码图查询边界
     * @param reranker         安全信号分析器
     */
    public GraphRagService(VectorStore vectorStore, GraphQueryService graphQueryService,
                           SecurityAwareReranker reranker) {
        this(vectorStore, graphQueryService, reranker, (query, options) -> List.of());
    }

    /**
     * 创建 GraphRAG 检索服务。
     *
     * @param vectorStore          向量检索边界
     * @param graphQueryService    代码图查询边界
     * @param reranker             安全信号分析器
     * @param keywordSearchService 关键词检索服务
     */
    @Autowired
    public GraphRagService(VectorStore vectorStore, GraphQueryService graphQueryService,
                           SecurityAwareReranker reranker, KeywordSearchService keywordSearchService) {
        this.vectorStore = vectorStore;
        this.graphQueryService = graphQueryService;
        this.reranker = reranker;
        this.keywordSearchService = keywordSearchService;
    }

    /**
     * 执行 GraphRAG 检索，返回综合排序后的结果。
     *
     * @param query   自然语言查询字符串，不为 {@code null}
     * @param options 检索选项；为 {@code null} 时使用 {@link GraphRagOptions#defaults()}
     * @return 包含排序结果和统计信息的 {@link GraphRagResult}
     */
    public GraphRagResult search(String query, GraphRagOptions options) {
        GraphRagOptions opts = options != null ? options : GraphRagOptions.defaults();

        // ── 第一步：向量种子检索 ─────────────────────────────────────────────
        SearchOptions searchOpts = new SearchOptions(
                opts.seedLimit(), 0, opts.lang(), null, opts.projectId(), false, opts.noTest());
        SearchPage seedPage = vectorStore.semanticSearch(query, searchOpts);
        List<SearchResult> seeds = seedPage.results();
        List<KeywordSearchResult> keywordSeeds = keywordSearchService.search(query,
                new KeywordSearchOptions(opts.seedLimit(), opts.lang(), null, opts.projectId(), opts.noTest()));

        // 按 qualifiedName 收集所有结果以去重
        Map<String, RankedUnit> results = new LinkedHashMap<>();
        int callGraphExpanded = 0;
        int impactExpanded = 0;

        for (SearchResult sr : seeds) {
            SecurityAwareReranker.SecurityAnalysis sec = reranker.analyze(sr.unit());
            // 种子：finalScore = 向量分 + 安全加分（最高 +0.5）
            float finalScore = sr.score() + securityBonus(opts, sec);
            results.put(sr.unit().qualifiedName(), new RankedUnit(
                    sr.unit(), sr.score(), sec.score(), finalScore,
                    "VECTOR", "SEED", sec.signals()));
        }

        for (KeywordSearchResult kr : keywordSeeds) {
            if (results.containsKey(kr.unit().qualifiedName())) continue;
            SecurityAwareReranker.SecurityAnalysis sec = reranker.analyze(kr.unit());
            float finalScore = kr.score() + securityBonus(opts, sec);
            List<String> signals = new ArrayList<>(sec.signals());
            for (String term : kr.matchedTerms()) {
                signals.add("keyword:" + term);
            }
            results.put(kr.unit().qualifiedName(), new RankedUnit(
                    kr.unit(), 0f, sec.score(), finalScore,
                    "KEYWORD", "SEED", List.copyOf(signals)));
        }

        // ── 第二步：调用图检索 ────────────────────────────────────────────────
        if (opts.callGraph()) {
            for (SearchResult sr : seeds) {
                String qn = sr.unit().qualifiedName();
                float seedScore = sr.score();

                // 调用方：调用种子方法的上游代码
                List<CodeUnit> callers = limitList(
                        graphQueryService.findCallers(qn, opts.graphDepth(), opts.projectId()),
                        MAX_EXPAND_PER_SEED);
                for (CodeUnit caller : callers) {
                    if (results.containsKey(caller.qualifiedName())) continue;
                    SecurityAwareReranker.SecurityAnalysis sec = reranker.analyze(caller);
                    // 调用方折扣：基础分 = seedScore * 0.6 + 安全加分
                    float finalScore = seedScore * 0.6f + securityBonus(opts, sec);
                    results.put(caller.qualifiedName(), new RankedUnit(
                            caller, 0f, sec.score(), finalScore,
                            "CALL_GRAPH", "CALLER", sec.signals()));
                    callGraphExpanded++;
                }

                // 被调用方：种子方法调用的下游代码
                List<CodeUnit> callees = limitList(
                        graphQueryService.findCallees(qn, opts.graphDepth(), opts.projectId()),
                        MAX_EXPAND_PER_SEED);
                for (CodeUnit callee : callees) {
                    if (results.containsKey(callee.qualifiedName())) continue;
                    SecurityAwareReranker.SecurityAnalysis sec = reranker.analyze(callee);
                    // 被调用方折扣略多（数据汇聚点，不太可能是"答案"）
                    float finalScore = seedScore * 0.5f + securityBonus(opts, sec);
                    results.put(callee.qualifiedName(), new RankedUnit(
                            callee, 0f, sec.score(), finalScore,
                            "CALL_GRAPH", "CALLEE", sec.signals()));
                    callGraphExpanded++;
                }
            }
        }

        // ── 第三步：影响面展开 ────────────────────────────────────────────────
        // 利用影响面分析，找出从种子出发可达的安全敏感节点
        // 依赖路径包括 CALLS、DEFINES_TYPE、OVERRIDES、EXTENDS、IMPLEMENTS
        // 仅将安全分大于 0 的节点加入结果，以控制结果集规模
        if (opts.impactExpansion()) {
            int seedsForImpact = Math.min(seeds.size(), MAX_SEEDS_FOR_IMPACT);
            for (int i = 0; i < seedsForImpact; i++) {
                String qn = seeds.get(i).unit().qualifiedName();
                Set<CodeUnit> impact = graphQueryService.impactAnalysis(qn, opts.projectId());
                int added = 0;
                for (CodeUnit node : impact) {
                    if (added >= MAX_IMPACT_PER_SEED) break;
                    if (results.containsKey(node.qualifiedName())) continue;
                    SecurityAwareReranker.SecurityAnalysis sec = reranker.analyze(node);
                    if (sec.score() <= 0f) continue;  // 仅保留安全相关节点
                    float finalScore = 0.2f + securityBonus(opts, sec);
                    results.put(node.qualifiedName(), new RankedUnit(
                            node, 0f, sec.score(), finalScore,
                            "IMPACT", "IMPACT", sec.signals()));
                    impactExpanded++;
                    added++;
                }
            }
        }

        // ── 第四步：安全感知重排序 ─────────────────────────────────────────────
        List<RankedUnit> sorted = new ArrayList<>(results.values());
        if (opts.rerank()) {
            sorted.sort(Comparator.comparingDouble(RankedUnit::finalScore).reversed());
        }

        long secHighlights = sorted.stream().filter(r -> r.securityScore() > 0.3f).count();

        return new GraphRagResult(
                Collections.unmodifiableList(sorted),
                seeds.size(),
                keywordSeeds.size(),
                callGraphExpanded,
                impactExpanded,
                (int) secHighlights
        );
    }

    private static <T> List<T> limitList(List<T> list, int max) {
        return list.size() <= max ? list : list.subList(0, max);
    }

    private static float securityBonus(GraphRagOptions options,
                                       SecurityAwareReranker.SecurityAnalysis analysis) {
        return options.rerank() ? 0.5f * analysis.score() : 0f;
    }
}
