package com.repograph.retrieval;

import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.retrieval.KeywordSearchOptions;
import com.repograph.core.retrieval.KeywordSearchResult;
import com.repograph.core.retrieval.KeywordSearchService;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 轻量关键词检索实现，面向符号名、规则 ID、CVE/CWE、配置 key 等精确召回场景。
 *
 * <p>当前实现是 BM25-like 的本地打分：查询词命中次数、字段权重和长度归一化结合。
 * 它不替代后续 SQLite FTS / Lucene，只作为 Hybrid Search 的最小可用基础设施。
 *
 * @author leolu
 */
@Service
public class SimpleKeywordSearchService implements KeywordSearchService {

    private static final Pattern TOKEN_SPLIT = Pattern.compile("[^A-Za-z0-9_.$#/-]+");
    private static final int DEFAULT_CANDIDATE_LIMIT = 5000;

    private final GraphDiagnosticsService graphDiagnosticsService;

    /**
     * 创建关键词检索服务。
     *
     * @param graphDiagnosticsService 图诊断查询接口
     */
    public SimpleKeywordSearchService(GraphDiagnosticsService graphDiagnosticsService) {
        this.graphDiagnosticsService = graphDiagnosticsService;
    }

    @Override
    public List<KeywordSearchResult> search(String query, KeywordSearchOptions options) {
        if (query == null || query.isBlank()) return List.of();
        KeywordSearchOptions opts = options != null ? options : KeywordSearchOptions.defaults();
        int limit = Math.max(1, Math.min(opts.limit(), 100));
        List<String> terms = tokenizeQuery(query);
        if (terms.isEmpty()) return List.of();

        List<CodeUnit> candidates = graphDiagnosticsService.listSearchTargets(
                opts.projectId(), opts.language(), opts.kind(), opts.noTest(), DEFAULT_CANDIDATE_LIMIT);

        return candidates.stream()
                .map(unit -> score(unit, terms))
                .filter(result -> result.score() > 0f)
                .sorted(Comparator.comparingDouble(KeywordSearchResult::score).reversed()
                        .thenComparing(result -> result.unit().qualifiedName()))
                .limit(limit)
                .toList();
    }

    private static KeywordSearchResult score(CodeUnit unit, List<String> terms) {
        String qualifiedName = lower(unit.qualifiedName());
        String simpleName = lower(unit.simpleName());
        String signature = lower(unit.signature());
        String rawSource = lower(unit.rawSource());
        Set<String> matched = new LinkedHashSet<>();
        double score = 0.0;

        for (String term : terms) {
            double termScore = 0.0;
            termScore += containsScore(qualifiedName, term, 6.0);
            termScore += containsScore(simpleName, term, 8.0);
            termScore += containsScore(signature, term, 4.0);
            termScore += countOccurrences(rawSource, term) * 1.0;
            if (termScore > 0.0) {
                matched.add(term);
                score += termScore;
            }
        }

        if (score <= 0.0) {
            return new KeywordSearchResult(unit, 0f, List.of());
        }

        double lengthPenalty = 1.0 + Math.log10(Math.max(10, rawSource.length()));
        float normalized = (float) Math.min(1.0, score / (10.0 * lengthPenalty));
        return new KeywordSearchResult(unit, normalized, List.copyOf(matched));
    }

    private static double containsScore(String text, String term, double weight) {
        if (text == null || text.isBlank()) return 0.0;
        if (text.equals(term)) return weight * 2.0;
        if (text.endsWith(term)) return weight * 1.5;
        return text.contains(term) ? weight : 0.0;
    }

    private static int countOccurrences(String text, String term) {
        if (text == null || text.isBlank() || term.isBlank()) return 0;
        int count = 0;
        int from = 0;
        while (true) {
            int idx = text.indexOf(term, from);
            if (idx < 0) return count;
            count++;
            from = idx + term.length();
        }
    }

    private static List<String> tokenizeQuery(String query) {
        List<String> terms = new ArrayList<>();
        for (String token : TOKEN_SPLIT.split(query.toLowerCase(Locale.ROOT))) {
            String t = token.trim();
            if (t.length() < 2 || isStopWord(t)) continue;
            terms.add(t);
        }
        return terms.stream().distinct().toList();
    }

    private static boolean isStopWord(String term) {
        return switch (term) {
            case "the", "and", "for", "with", "from", "this", "that", "into", "where",
                 "what", "when", "how", "why", "是否", "这个", "那个" -> true;
            default -> false;
        };
    }

    private static String lower(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
