package com.repograph.finding;

import com.repograph.core.finding.ExternalFinding;
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
                    detected.add(new ProtectionSignal(item.citationId(), pattern.description()));
                }
            }
        }
        return List.copyOf(detected);
    }

    private static boolean isProtectionScope(ContextEvidence evidence) {
        return "FINDING".equals(evidence.source()) || "CALLEE".equals(evidence.relation());
    }

    record ProtectionSignal(String citationId, String description) {
    }

    private record ProtectionPattern(String description, List<String> markers) {
    }
}
