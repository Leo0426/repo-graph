package com.repograph.finding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.DetectionRule;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.RuleFormatter;
import com.repograph.core.finding.RuleMatcherKind;
import com.repograph.core.finding.RuleStatus;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.yaml.snakeyaml.Yaml;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 规则导出契约：目标格式、原始元数据、字面匹配与确定性文本。
 *
 * @author leolu
 */
class RuleFormatterTest {

    private final RuleFormatter formatter = new DefaultRuleFormatter();
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void regexExportMatchesReviewedSnapshots() throws Exception {
        DetectionRule rule = rule(RuleMatcherKind.REGEX, "Runtime\\.getRuntime\\(\\)\\.exec",
                ExternalFindingSeverity.HIGH, 3);

        assertThat(formatter.toSemgrepYaml(rule)).isEqualTo(snapshot("regex.yaml"));
        assertThat(formatter.toSourceSinkJson(rule)).isEqualTo(snapshot("regex.json"));
        JsonNode yaml = semgrepRule(rule);
        assertThat(yaml.path("languages").get(0).asText()).isEqualTo("java");
        assertThat(yaml.path("message").asText()).isEqualTo("Runtime command injection");
        assertThat(yaml.path("pattern-regex").asText()).isEqualTo("(?s-m)Runtime\\.getRuntime\\(\\)\\.exec");
    }

    @Test
    void substringExportKeepsMetacharactersQuotesAndNewlinesLiteral() throws Exception {
        String literal = "$X...*(input)\\E #中文\n'quoted'";
        DetectionRule rule = rule(RuleMatcherKind.SUBSTRING, literal, ExternalFindingSeverity.LOW, 1);

        JsonNode yaml = semgrepRule(rule);
        assertThat(yaml.has("pattern")).isFalse();
        Pattern exported = Pattern.compile(yaml.path("pattern-regex").asText());
        assertThat(exported.matcher("before " + literal + " after").find()).isTrue();
        assertThat(exported.matcher("$Y xyz input #中文 'quoted'").find()).isFalse();
        assertThat(yaml.path("metadata").path("repograph-pattern").asText()).isEqualTo(literal);
        assertThat(yaml.path("metadata").path("repograph-matcher-kind").asText()).isEqualTo("SUBSTRING");

        JsonNode sourceSink = json.readTree(formatter.toSourceSinkJson(rule));
        assertThat(sourceSink.path("sources")).isEmpty();
        assertThat(sourceSink.path("sinks")).hasSize(1);
        assertThat(sourceSink.path("sinks").get(0).path("pattern").asText()).isEqualTo(literal);
        assertThat(sourceSink.path("sinks").get(0).path("matcherKind").asText()).isEqualTo("SUBSTRING");
    }

    @Test
    void regexExportPreservesDotallAndNonMultilineDefaults() {
        DetectionRule rule = rule(RuleMatcherKind.REGEX, "^first.*last$", ExternalFindingSeverity.HIGH, 1);
        Pattern exported = Pattern.compile(semgrepRule(rule).path("pattern-regex").asText(), Pattern.MULTILINE);

        assertThat(exported.matcher("first\nlast").find()).isTrue();
        assertThat(exported.matcher("prefix\nfirst\nlast\nsuffix").find()).isFalse();
    }

    @ParameterizedTest
    @CsvSource({"CRITICAL, ERROR", "HIGH, ERROR", "MEDIUM, WARNING", "LOW, INFO", "INFO, INFO", "UNKNOWN, WARNING"})
    void mapsEverySeverityExplicitly(ExternalFindingSeverity severity, String semgrepSeverity) throws Exception {
        DetectionRule rule = rule(RuleMatcherKind.SUBSTRING, "exec(", severity, 1);

        assertThat(semgrepRule(rule).path("severity").asText()).isEqualTo(semgrepSeverity);
        assertThat(json.readTree(formatter.toSourceSinkJson(rule)).path("severity").asText())
                .isEqualTo(severity.name());
    }

    @Test
    void metadataChangesAppearInBothFormats() throws Exception {
        DetectionRule first = rule(RuleMatcherKind.REGEX, "exec", ExternalFindingSeverity.HIGH, 3);
        DetectionRule second = rule(RuleMatcherKind.REGEX, "exec", ExternalFindingSeverity.MEDIUM, 4);

        JsonNode firstYaml = semgrepRule(first);
        JsonNode secondYaml = semgrepRule(second);
        JsonNode firstJson = json.readTree(formatter.toSourceSinkJson(first));
        JsonNode secondJson = json.readTree(formatter.toSourceSinkJson(second));
        assertThat(firstYaml.path("metadata").path("repograph-version").asInt()).isEqualTo(3);
        assertThat(secondYaml.path("metadata").path("repograph-version").asInt()).isEqualTo(4);
        assertThat(firstJson.path("version").asInt()).isEqualTo(3);
        assertThat(secondJson.path("version").asInt()).isEqualTo(4);
        assertThat(secondYaml.path("severity").asText()).isEqualTo("WARNING");
        assertThat(secondJson.path("severity").asText()).isEqualTo("MEDIUM");
        for (DetectionRule rule : List.of(first, second)) {
            JsonNode yaml = semgrepRule(rule);
            JsonNode sourceSink = json.readTree(formatter.toSourceSinkJson(rule));
            assertThat(yaml.path("id").asText()).isEqualTo("java.command-injection");
            assertThat(sourceSink.path("ruleId").asText()).isEqualTo("java.command-injection");
            assertThat(yaml.path("metadata").path("cwe").asText()).isEqualTo("CWE-78");
            assertThat(sourceSink.path("cwe").asText()).isEqualTo("CWE-78");
            assertThat(yaml.path("metadata").path("repograph-source").asText())
                    .isEqualTo("internal-security-team");
            assertThat(sourceSink.path("source").asText()).isEqualTo("internal-security-team");
            assertThat(yaml.path("metadata").path("repograph-languages")).isEqualTo(sourceSink.path("languages"));
            assertThat(yaml.path("metadata").path("repograph-frameworks")).isEqualTo(sourceSink.path("frameworks"));
        }
    }

    @Test
    void serializesUntrustedTextAsDataWithoutAddingRules() throws Exception {
        DetectionRule rule = new DetectionRule("java.command-injection", 1, "yes", List.of("java"), List.of("on"),
                "CWE-78", ExternalFindingSeverity.HIGH, "检测: 'exec'\nrules:\n- id: injected",
                RuleMatcherKind.SUBSTRING, "!!java/object: injected", RuleStatus.CANDIDATE,
                List.of("sample"), List.of("safe"), "notes", false, "", "");

        JsonNode document = json.valueToTree(new Yaml().load(formatter.toSemgrepYaml(rule)));
        assertThat(document.path("rules")).hasSize(1);
        assertThat(document.path("rules").get(0).path("message").asText())
                .isEqualTo("检测: 'exec'\nrules:\n- id: injected");
        assertThat(document.path("rules").get(0).path("metadata").path("repograph-source").asText()).isEqualTo("yes");
        assertThat(json.readTree(formatter.toSourceSinkJson(rule)).path("sinks").get(0).path("pattern").asText())
                .isEqualTo("!!java/object: injected");
    }

    @Test
    void repeatedExportsAreByteIdenticalAndLeaveTheRuleUnchanged() {
        DetectionRule rule = rule(RuleMatcherKind.SUBSTRING, "exec(", ExternalFindingSeverity.UNKNOWN, 7);
        String yaml = formatter.toSemgrepYaml(rule);
        String sourceSink = formatter.toSourceSinkJson(rule);

        assertThat(yaml).isNotBlank();
        assertThat(sourceSink).isNotBlank();
        assertThat(formatter.toSemgrepYaml(rule)).isEqualTo(yaml);
        assertThat(formatter.toSourceSinkJson(rule)).isEqualTo(sourceSink);
        assertThat(rule.pattern()).isEqualTo("exec(");
        assertThat(rule.version()).isEqualTo(7);
        assertThat(rule.status()).isEqualTo(RuleStatus.PUBLISHED);
    }

    private JsonNode semgrepRule(DetectionRule rule) {
        JsonNode document = json.valueToTree(new Yaml().load(formatter.toSemgrepYaml(rule)));
        assertThat(document.path("rules")).hasSize(1);
        return document.path("rules").get(0);
    }

    private String snapshot(String name) throws Exception {
        try (var stream = getClass().getResourceAsStream("/rule-formatters/" + name)) {
            assertThat(stream).isNotNull();
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    static DetectionRule rule(RuleMatcherKind kind, String pattern, ExternalFindingSeverity severity, int version) {
        return new DetectionRule("java.command-injection", version, "internal-security-team",
                List.of("java"), List.of("spring"), "CWE-78", severity, "Runtime command injection",
                kind, pattern, RuleStatus.PUBLISHED, List.of("positive"), List.of("negative"),
                "reviewed", true, "2026-10-22T00:00:00Z", "2026-10-22T00:00:00Z");
    }
}
