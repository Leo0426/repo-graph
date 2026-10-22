package com.repograph.finding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.RuleMatcherKind;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * 使用本地 Semgrep CLI 验证真实导出文件及阳性/阴性样本；未配置命令时显式跳过。
 *
 * @author leolu
 */
class RuleFormatterSemgrepIT {

    @TempDir
    Path directory;

    @ParameterizedTest
    @EnumSource(RuleMatcherKind.class)
    void exportedRuleRunsWithOriginalMatchingSemantics(RuleMatcherKind kind) throws Exception {
        String command = System.getProperty("test.semgrep.command");
        assumeTrue(command != null && !command.isBlank(), "Set -Dtest.semgrep.command to a local Semgrep executable");
        String pattern = kind == RuleMatcherKind.REGEX
                ? "^// first.*// last$" : "exec($X...)\\E #中文\n// literal";
        String positive = kind == RuleMatcherKind.REGEX
                ? "// first\n// last" : "// " + pattern;
        String negative = kind == RuleMatcherKind.REGEX
                ? "// prefix\n// first\n// last\n// suffix" : "// exec(input) #中文\n// literal";
        var rule = RuleFormatterTest.rule(kind, pattern, ExternalFindingSeverity.HIGH, 1);
        Files.writeString(directory.resolve("rule.yaml"), new DefaultRuleFormatter().toSemgrepYaml(rule));
        Files.writeString(directory.resolve("Positive.java"), positive);
        Files.writeString(directory.resolve("Negative.java"), negative);
        Path output = directory.resolve("result.json");
        Path errors = directory.resolve("stderr.txt");
        ProcessBuilder builder = new ProcessBuilder(command, "scan", "--config", "rule.yaml", "--json", "--quiet",
                "--metrics=off", "--disable-version-check", "--oss-only", "--disable-nosem",
                "--no-git-ignore", "--no-rewrite-rule-ids", "Positive.java", "Negative.java")
                .directory(directory.toFile()).redirectOutput(output.toFile()).redirectError(errors.toFile());
        builder.environment().put("SEMGREP_SETTINGS_FILE", directory.resolve("settings.yaml").toString());
        builder.environment().remove("SEMGREP_APP_TOKEN");
        Process process = builder.start();
        try {
            assertThat(process.waitFor(30, TimeUnit.SECONDS)).as("Semgrep must finish within 30 seconds").isTrue();
            assertThat(process.exitValue()).as(Files.readString(errors)).isZero();
            JsonNode result = new ObjectMapper().readTree(Files.readString(output));
            assertThat(result.path("errors")).isEmpty();
            assertThat(result.path("results")).hasSize(1);
            assertThat(result.path("results").get(0).path("path").asText()).isEqualTo("Positive.java");
            assertThat(result.path("results").get(0).path("check_id").asText()).isEqualTo("java.command-injection");
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
            }
        }
    }
}
