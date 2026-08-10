package com.repograph.retrieval;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.retrieval.ContextEvidence;
import com.repograph.core.retrieval.ContextPack;
import com.repograph.core.retrieval.ContextPackOptions;
import com.repograph.core.retrieval.GraphRagResult;
import com.repograph.core.retrieval.RankedUnit;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 将 GraphRAG 结果组装为 LLM Agent 可直接消费的上下文包。
 *
 * <p>该服务不生成答案，只负责预算控制、证据编号、去空片段与截断说明。
 *
 * @author leolu
 */
@Service
public class ContextPackService {

    private static final int MIN_BUDGET_CHARS = 1000;
    private static final int MAX_BUDGET_CHARS = 60000;
    private static final int TARGET_EVIDENCE_COUNT = 4;

    private final GraphRagService graphRagService;

    /**
     * 创建上下文包服务。
     *
     * @param graphRagService GraphRAG 检索服务
     */
    public ContextPackService(GraphRagService graphRagService) {
        this.graphRagService = graphRagService;
    }

    /**
     * 构建带 citation 的上下文证据包。
     *
     * @param query   自然语言查询
     * @param options 上下文组装选项；为空时使用默认值
     * @return 上下文包
     */
    public ContextPack build(String query, ContextPackOptions options) {
        ContextPackOptions opts = options != null ? options : ContextPackOptions.defaults();
        GraphRagResult graphRag = graphRagService.search(query, opts.graphRag());
        return assemble(query, opts, graphRag.results(),
                graphRag.seedCount(), graphRag.keywordSeedCount(),
                graphRag.callGraphExpanded(), graphRag.impactExpanded(),
                List.of());
    }

    /**
     * 将已排序的检索结果按预算组装为带 citation 的上下文包。
     *
     * <p>供 GraphRAG 查询之外的入口（如外部报警研判）复用同一套预算裁剪与证据编号规则。
     *
     * @param query              原始查询或报警描述
     * @param options            上下文组装选项；为空时使用默认值
     * @param rankedUnits        已按期望顺序排列的检索结果
     * @param seedCount          种子数量统计
     * @param keywordSeedCount   关键词种子数量统计
     * @param callGraphExpanded  调用图扩展数量统计
     * @param impactExpanded     影响面扩展数量统计
     * @param extraOmittedReasons 组装前已知的缺失原因，置于省略说明最前
     * @return 上下文包
     */
    public ContextPack assemble(String query, ContextPackOptions options, List<RankedUnit> rankedUnits,
                                int seedCount, int keywordSeedCount,
                                int callGraphExpanded, int impactExpanded,
                                List<String> extraOmittedReasons) {
        ContextPackOptions opts = options != null ? options : ContextPackOptions.defaults();
        int budget = Math.max(MIN_BUDGET_CHARS, Math.min(opts.budgetChars(), MAX_BUDGET_CHARS));
        String taskType = opts.taskType() == null || opts.taskType().isBlank() ? "detail" : opts.taskType();

        List<ContextEvidence> evidence = new ArrayList<>();
        List<String> omitted = new ArrayList<>(extraOmittedReasons);
        int used = 0;
        int citation = 1;
        long viableCandidates = rankedUnits.stream()
                .map(ranked -> ranked.unit().rawSource())
                .filter(source -> source != null && !source.isBlank())
                .count();
        int evidenceBudget = budget / Math.max(1,
                Math.min(TARGET_EVIDENCE_COUNT, Math.toIntExact(viableCandidates)));

        for (RankedUnit ranked : rankedUnits) {
            CodeUnit unit = ranked.unit();
            String source = unit.rawSource() != null ? unit.rawSource().strip() : "";
            if (source.isBlank()) {
                omitted.add(unit.qualifiedName() + ": empty rawSource");
                continue;
            }

            int remaining = Math.min(budget - used, evidenceBudget);
            if (remaining <= 0) {
                omitted.add(unit.qualifiedName() + ": budget exhausted");
                continue;
            }

            String excerpt = source;
            boolean truncated = false;
            if (excerpt.length() > remaining) {
                excerpt = excerpt.substring(0, remaining).stripTrailing();
                truncated = true;
                omitted.add(unit.qualifiedName() + ": excerpt truncated by budget");
            }

            if (excerpt.isBlank()) {
                omitted.add(unit.qualifiedName() + ": no remaining budget for excerpt");
                continue;
            }

            used += excerpt.length();
            evidence.add(new ContextEvidence(
                    "C" + citation++,
                    unit.qualifiedName(),
                    unit.kind().name(),
                    unit.language(),
                    unit.filePath(),
                    unit.startLine(),
                    unit.endLine(),
                    ranked.source(),
                    ranked.relation(),
                    ranked.finalScore(),
                    excerpt,
                    truncated,
                    ranked.securitySignals()
            ));
        }

        return new ContextPack(
                query,
                taskType,
                List.copyOf(evidence),
                List.copyOf(omitted),
                budget,
                used,
                seedCount,
                keywordSeedCount,
                callGraphExpanded,
                impactExpanded
        );
    }
}
