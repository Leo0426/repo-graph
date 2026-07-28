package com.repograph.finding;

import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingTraceStep;
import com.repograph.core.retrieval.ContextEvidence;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 从可引用代码证据中识别与 CWE 匹配的防护措施候选。
 *
 * <p>该检测器只产生“存在防护代码”的启发式证据，
 * 不证明防护覆盖了 source 到 sink 的完整数据流。
 *
 * @author leolu
 */
final class ProtectionSignalDetector {

    private static final Map<String, List<ProtectionPattern>> CWE_PATTERNS = Map.of(
            "CWE-78", List.of(new ProtectionPattern("输入校验", List.of(
                    ".matches(", "pattern.matches(", "allowlist", "whitelist", "validatecommand"))),
            "CWE-89", List.of(new ProtectionPattern("参数化查询", List.of(
                    "preparedstatement", "preparestatement(", "namedparameterjdbctemplate"))),
            "CWE-79", List.of(new ProtectionPattern("输出编码或 HTML 清理", List.of(
                    "htmlutils.htmlescape", "stringescapeutils.escapehtml", "encodeforhtml", "jsoup.clean"))),
            "CWE-22", List.of(new ProtectionPattern("路径规范化与目录约束", List.of(
                    "getcanonicalpath(", ".torealpath(", ".normalize(", "startswith("))),
            "CWE-502", List.of(new ProtectionPattern("反序列化类型过滤", List.of(
                    "objectinputfilter", "setobjectinputfilter(", "serialfilter")))
    );

    private ProtectionSignalDetector() {
    }

    static List<ProtectionSignal> detect(ExternalFinding finding, List<ContextEvidence> evidence) {
        List<ProtectionPattern> patterns = CWE_PATTERNS.getOrDefault(finding.cwe(), List.of());
        if (patterns.isEmpty()) return List.of();

        List<ProtectionSignal> detected = new ArrayList<>();
        for (ContextEvidence item : evidence) {
            if (!isProtectionScope(item)) continue;
            String excerpt = item.excerpt().toLowerCase(Locale.ROOT);
            for (ProtectionPattern pattern : patterns) {
                if (pattern.markers().stream().anyMatch(excerpt::contains)) {
                    PathAlignment alignment = pathAlignment(finding.trace(), item);
                    detected.add(new ProtectionSignal(
                            item.citationId(),
                            pattern.description(),
                            alignment.aligned(),
                            alignment.summary()));
                }
            }
        }
        return List.copyOf(detected);
    }

    private static boolean isProtectionScope(ContextEvidence evidence) {
        return "FINDING".equals(evidence.source()) || "CALLEE".equals(evidence.relation());
    }

    private static PathAlignment pathAlignment(
            List<ExternalFindingTraceStep> trace,
            ContextEvidence evidence) {
        if (trace.isEmpty()) {
            return new PathAlignment(false, "external finding has no source/sink trace");
        }
        List<Integer> sourceIndexes = indexesOf(trace, "source");
        List<Integer> sinkIndexes = indexesOf(trace, "sink");
        if (sourceIndexes.isEmpty() || sinkIndexes.isEmpty()) {
            return new PathAlignment(false, "trace does not identify both source and sink");
        }
        for (int index = 0; index < trace.size(); index++) {
            ExternalFindingTraceStep step = trace.get(index);
            if (!isProtectionStep(step) || !matchesEvidence(step, evidence)) {
                continue;
            }
            int protectionIndex = index;
            boolean afterAllSources = sourceIndexes.stream().allMatch(source -> source < protectionIndex);
            boolean beforeAllSinks = sinkIndexes.stream().allMatch(sink -> protectionIndex < sink);
            if (afterAllSources && beforeAllSinks) {
                return new PathAlignment(
                        true,
                        "trace source" + sourceIndexes + " -> sanitizer[" + protectionIndex
                                + "] -> sink" + sinkIndexes);
            }
        }
        return new PathAlignment(false, "protection candidate is not between every source and sink");
    }

    private static List<Integer> indexesOf(List<ExternalFindingTraceStep> trace, String kind) {
        List<Integer> result = new ArrayList<>();
        for (int index = 0; index < trace.size(); index++) {
            if (kind.equalsIgnoreCase(trace.get(index).kind())) {
                result.add(index);
            }
        }
        return result;
    }

    private static boolean isProtectionStep(ExternalFindingTraceStep step) {
        String kind = step.kind().toLowerCase(Locale.ROOT);
        return kind.equals("sanitizer")
                || kind.equals("validation")
                || kind.equals("guard")
                || kind.equals("barrier");
    }

    private static boolean matchesEvidence(
            ExternalFindingTraceStep step,
            ContextEvidence evidence) {
        if (!step.filePath().equals(evidence.filePath())) {
            return false;
        }
        if (step.startLine() > 0
                && step.startLine() >= evidence.startLine()
                && step.startLine() <= evidence.endLine()) {
            return true;
        }
        return !step.symbol().isBlank()
                && evidence.qualifiedName().toLowerCase(Locale.ROOT)
                .contains(step.symbol().toLowerCase(Locale.ROOT));
    }

    record ProtectionSignal(
            String citationId,
            String description,
            boolean pathAligned,
            String pathSummary) {
    }

    private record ProtectionPattern(String description, List<String> markers) {
    }

    private record PathAlignment(boolean aligned, String summary) {
    }
}
