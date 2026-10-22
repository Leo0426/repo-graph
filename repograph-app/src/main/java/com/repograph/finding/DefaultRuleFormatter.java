package com.repograph.finding;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectWriter;
import com.repograph.core.finding.DetectionRule;
import com.repograph.core.finding.RuleFormatter;
import com.repograph.core.finding.RuleMatcherKind;
import org.springframework.stereotype.Service;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * 检测规则的纯文本格式化实现。
 *
 * @author leolu
 */
@Service
public final class DefaultRuleFormatter implements RuleFormatter {

    private static final ObjectWriter JSON = new ObjectMapper().writer();

    /** {@inheritDoc} */
    @Override
    public String toSemgrepYaml(DetectionRule rule) {
        Map<String, Object> metadata = new TreeMap<>();
        metadata.put("cwe", rule.cwe());
        metadata.put("repograph-frameworks", new ArrayList<>(rule.frameworks()));
        metadata.put("repograph-languages", new ArrayList<>(rule.languages()));
        metadata.put("repograph-matcher-kind", rule.matcherKind().name());
        metadata.put("repograph-pattern", rule.pattern());
        if (rule.matcherKind() == RuleMatcherKind.REGEX) {
            metadata.put("repograph-regex-engine", "JAVA");
        }
        metadata.put("repograph-source", rule.source());
        metadata.put("repograph-version", rule.version());

        Map<String, Object> exported = new TreeMap<>();
        exported.put("id", rule.ruleId());
        exported.put("languages", new ArrayList<>(rule.languages()));
        exported.put("message", rule.title());
        exported.put("metadata", metadata);
        // Semgrep's AST pattern syntax cannot express String.contains. PCRE2 supports Java's \Q...\E quoting.
        // Registry regexes use DOTALL; Semgrep enables MULTILINE by default, so set both defaults explicitly.
        exported.put("pattern-regex", switch (rule.matcherKind()) {
            case SUBSTRING -> Pattern.quote(rule.pattern());
            case REGEX -> "(?s-m)" + rule.pattern();
        });
        exported.put("severity", switch (rule.severity()) {
            case CRITICAL, HIGH -> "ERROR";
            case MEDIUM, UNKNOWN -> "WARNING";
            case LOW, INFO -> "INFO";
        });

        DumperOptions options = new DumperOptions();
        options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        options.setSplitLines(false);
        options.setLineBreak(DumperOptions.LineBreak.UNIX);
        // Yaml is not thread-safe; each invocation owns its emitter and only serializes ordinary collections.
        return new Yaml(options).dump(Map.of("rules", List.of(exported)));
    }

    /** {@inheritDoc} */
    @Override
    public String toSourceSinkJson(DetectionRule rule) {
        Map<String, Object> sink = new TreeMap<>();
        sink.put("matcherKind", rule.matcherKind().name());
        sink.put("pattern", rule.pattern());
        if (rule.matcherKind() == RuleMatcherKind.REGEX) {
            sink.put("regexEngine", "JAVA");
            sink.put("regexFlags", List.of("DOTALL"));
        }
        Map<String, Object> exported = new TreeMap<>();
        exported.put("cwe", rule.cwe());
        exported.put("frameworks", rule.frameworks());
        exported.put("languages", rule.languages());
        exported.put("ruleId", rule.ruleId());
        exported.put("severity", rule.severity().name());
        exported.put("sinks", List.of(sink));
        exported.put("source", rule.source());
        exported.put("sources", List.of());
        exported.put("version", rule.version());
        try {
            return JSON.writeValueAsString(exported) + "\n";
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Failed to serialize rule export", error);
        }
    }
}
