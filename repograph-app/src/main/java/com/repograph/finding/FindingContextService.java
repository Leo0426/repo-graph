package com.repograph.finding;

import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.retrieval.ContextPack;
import com.repograph.core.retrieval.ContextPackOptions;
import com.repograph.core.retrieval.GraphRagOptions;
import com.repograph.core.retrieval.KeywordSearchOptions;
import com.repograph.core.retrieval.KeywordSearchResult;
import com.repograph.core.retrieval.KeywordSearchService;
import com.repograph.core.retrieval.RankedUnit;
import com.repograph.core.vector.VectorStore;
import com.repograph.retrieval.ContextPackService;
import com.repograph.retrieval.SecurityAwareReranker;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 外部报警上下文构建服务，为单条 SAST 报警组装可研判的证据包。
 *
 * <p>构建流程：
 *
 * <ol>
 *   <li><b>报警定位</b>：按 filePath + startLine 定位报警所在 {@link CodeUnit}，作为首条证据</li>
 *   <li><b>调用图扩展</b>：以定位单元为种子展开 callers / callees</li>
 *   <li><b>影响面扩展</b>：从定位单元出发补充安全相关节点</li>
 *   <li><b>关键词补充</b>：用 ruleId / cwe / symbol / message 做关键词检索，证据来源标记为 {@code KEYWORD}</li>
 * </ol>
 *
 * <p>报警位置未被索引时不抛异常，而是在上下文包的省略原因中说明缺失，并仍返回关键词证据。
 *
 * @author leolu
 */
@Service
public class FindingContextService {

    /** 定位种子最多展开的调用方/被调用方数量。 */
    private static final int MAX_EXPAND_PER_SEED = 20;

    /** 影响面扩展最多补充的安全相关节点数量。 */
    private static final int MAX_IMPACT_NODES = 20;

    /** 定位证据的基础分，保证报警位置始终排在证据首位。 */
    private static final float LOCATION_BASE_SCORE = 1.0f;

    private final VectorStore vectorStore;
    private final GraphQueryService graphQueryService;
    private final KeywordSearchService keywordSearchService;
    private final SecurityAwareReranker reranker;
    private final ContextPackService contextPackService;

    /**
     * 创建报警上下文构建服务。
     *
     * @param vectorStore          向量索引边界，提供按位置定位能力
     * @param graphQueryService    代码图查询边界
     * @param keywordSearchService 关键词检索服务
     * @param reranker             安全信号分析器
     * @param contextPackService   上下文包组装服务
     */
    public FindingContextService(VectorStore vectorStore, GraphQueryService graphQueryService,
                                 KeywordSearchService keywordSearchService, SecurityAwareReranker reranker,
                                 ContextPackService contextPackService) {
        this.vectorStore = vectorStore;
        this.graphQueryService = graphQueryService;
        this.keywordSearchService = keywordSearchService;
        this.reranker = reranker;
        this.contextPackService = contextPackService;
    }

    /**
     * 为单条外部报警构建研判上下文。
     *
     * @param finding 外部报警，不为 {@code null}
     * @param options 上下文组装选项；为空时使用默认值
     * @return 报警研判上下文
     */
    public FindingContext build(ExternalFinding finding, ContextPackOptions options) {
        ContextPackOptions opts = options != null ? options : ContextPackOptions.defaults();
        GraphRagOptions rag = opts.graphRag() != null ? opts.graphRag() : GraphRagOptions.defaults();
        String query = buildQuery(finding);

        Map<String, RankedUnit> results = new LinkedHashMap<>();
        List<String> omitted = new ArrayList<>();
        int callGraphExpanded = 0;
        int impactExpanded = 0;

        Optional<CodeUnit> located = vectorStore.locateByPosition(finding.filePath(), finding.startLine());
        if (located.isEmpty()) {
            omitted.add("finding location not indexed: "
                    + finding.filePath() + ":" + finding.startLine());
        } else {
            CodeUnit unit = located.get();
            SecurityAwareReranker.SecurityAnalysis sec = reranker.analyze(unit);
            results.put(unit.qualifiedName(), new RankedUnit(
                    unit, 0f, sec.score(), LOCATION_BASE_SCORE + 0.5f * sec.score(),
                    "FINDING", "SEED", sec.signals()));

            if (rag.callGraph()) {
                callGraphExpanded += expandCallGraph(results, unit.qualifiedName(), rag, true);
                callGraphExpanded += expandCallGraph(results, unit.qualifiedName(), rag, false);
            }
            if (rag.impactExpansion()) {
                impactExpanded = expandImpact(results, unit.qualifiedName(), rag);
            }
        }

        int keywordSeeds = appendKeywordHits(results, query, rag);

        ContextPack pack = contextPackService.assemble(query, opts,
                List.copyOf(results.values()),
                located.isPresent() ? 1 : 0, keywordSeeds,
                callGraphExpanded, impactExpanded, omitted);
        return new FindingContext(finding, located.isPresent(),
                located.map(CodeUnit::qualifiedName).orElse(""), pack);
    }

    private int expandCallGraph(Map<String, RankedUnit> results, String qualifiedName,
                                GraphRagOptions rag, boolean callers) {
        List<CodeUnit> neighbors = callers
                ? graphQueryService.findCallers(qualifiedName, rag.graphDepth(), rag.projectId())
                : graphQueryService.findCallees(qualifiedName, rag.graphDepth(), rag.projectId());
        if (neighbors.size() > MAX_EXPAND_PER_SEED) {
            neighbors = neighbors.subList(0, MAX_EXPAND_PER_SEED);
        }
        int added = 0;
        for (CodeUnit neighbor : neighbors) {
            if (results.containsKey(neighbor.qualifiedName())) continue;
            SecurityAwareReranker.SecurityAnalysis sec = reranker.analyze(neighbor);
            float base = callers ? 0.6f : 0.5f;
            results.put(neighbor.qualifiedName(), new RankedUnit(
                    neighbor, 0f, sec.score(), base + 0.5f * sec.score(),
                    "CALL_GRAPH", callers ? "CALLER" : "CALLEE", sec.signals()));
            added++;
        }
        return added;
    }

    private int expandImpact(Map<String, RankedUnit> results, String qualifiedName, GraphRagOptions rag) {
        Set<CodeUnit> impact = graphQueryService.impactAnalysis(qualifiedName, rag.projectId());
        int added = 0;
        for (CodeUnit node : impact) {
            if (added >= MAX_IMPACT_NODES) break;
            if (results.containsKey(node.qualifiedName())) continue;
            SecurityAwareReranker.SecurityAnalysis sec = reranker.analyze(node);
            if (sec.score() <= 0f) continue;
            results.put(node.qualifiedName(), new RankedUnit(
                    node, 0f, sec.score(), 0.2f + 0.5f * sec.score(),
                    "IMPACT", "IMPACT", sec.signals()));
            added++;
        }
        return added;
    }

    private int appendKeywordHits(Map<String, RankedUnit> results, String query, GraphRagOptions rag) {
        List<KeywordSearchResult> hits = keywordSearchService.search(query,
                new KeywordSearchOptions(rag.seedLimit(), rag.lang(), null, rag.projectId(), rag.noTest()));
        int added = 0;
        for (KeywordSearchResult hit : hits) {
            if (results.containsKey(hit.unit().qualifiedName())) continue;
            SecurityAwareReranker.SecurityAnalysis sec = reranker.analyze(hit.unit());
            List<String> signals = new ArrayList<>(sec.signals());
            for (String term : hit.matchedTerms()) {
                signals.add("keyword:" + term);
            }
            results.put(hit.unit().qualifiedName(), new RankedUnit(
                    hit.unit(), 0f, sec.score(), hit.score() + 0.5f * sec.score(),
                    "KEYWORD", "SEED", List.copyOf(signals)));
            added++;
        }
        return added;
    }

    private static String buildQuery(ExternalFinding finding) {
        StringBuilder query = new StringBuilder(finding.ruleId());
        if (!finding.cwe().isBlank()) {
            query.append(' ').append(finding.cwe());
        }
        if (!finding.symbol().isBlank()) {
            query.append(' ').append(finding.symbol());
        }
        query.append(' ').append(finding.message());
        return query.toString();
    }
}
