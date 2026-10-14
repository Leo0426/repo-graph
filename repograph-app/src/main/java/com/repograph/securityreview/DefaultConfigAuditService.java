package com.repograph.securityreview;

import com.repograph.core.securityreview.AuditDimension;
import com.repograph.core.securityreview.ConfigAuditReport;
import com.repograph.core.securityreview.ConfigAuditRequest;
import com.repograph.core.securityreview.ConfigAuditRule;
import com.repograph.core.securityreview.ConfigAuditService;
import com.repograph.core.securityreview.ConfigRuleMatcher;
import com.repograph.core.securityreview.ConfigViolation;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 配置核查服务默认实现。
 *
 * <p>规则集从 classpath {@code security-review/rules/*.json} 加载；对每个待核查文件按 key-value
 * 行解析后逐规则求值。某维度有规则且被请求才参与核查，未覆盖维度不出现在报告中。
 *
 * @author leolu
 */
@Component
public class DefaultConfigAuditService implements ConfigAuditService {

    /** 规则集 classpath 位置。 */
    static final String RULES_LOCATION = "classpath*:security-review/rules/*.json";

    private static final Set<String> ENABLED_VALUES = Set.of("yes", "on", "1", "true", "enabled");

    private final List<ConfigAuditRule> rules;

    /**
     * 创建核查服务并加载 classpath 规则集。
     */
    public DefaultConfigAuditService() {
        this.rules = new ClasspathRuleSetLoader<ConfigAuditRule>(ConfigAuditRule.class).load(RULES_LOCATION);
    }

    /**
     * 以显式规则集创建核查服务，供测试注入。
     *
     * @param rules 核查规则列表
     */
    DefaultConfigAuditService(List<ConfigAuditRule> rules) {
        this.rules = List.copyOf(rules);
    }

    @Override
    public ConfigAuditReport audit(ConfigAuditRequest request) {
        Set<AuditDimension> requested = request.dimensions().isEmpty()
                ? EnumSet.noneOf(AuditDimension.class)
                : EnumSet.copyOf(request.dimensions());
        List<ConfigAuditRule> activeRules = rules.stream()
                .filter(rule -> requested.isEmpty() || requested.contains(rule.dimension()))
                .toList();

        List<ConfigViolation> violations = new ArrayList<>();
        for (ConfigAuditRequest.ConfigAuditFile file : request.files()) {
            List<ConfigLine> lines = KeyValueConfigLineParser.parse(file.content());
            for (ConfigAuditRule rule : activeRules) {
                violations.addAll(evaluate(rule, file.name(), lines));
            }
        }
        violations.sort(Comparator.comparing(ConfigViolation::filePath)
                .thenComparing(v -> v.lineNumber() == null ? 0 : v.lineNumber()));
        List<AuditDimension> audited = activeRules.stream()
                .map(ConfigAuditRule::dimension)
                .distinct()
                .toList();
        return new ConfigAuditReport(audited, activeRules.size(), request.files().size(), violations, Instant.now());
    }

    private List<ConfigViolation> evaluate(ConfigAuditRule rule, String filePath, List<ConfigLine> lines) {
        ConfigRuleMatcher matcher = rule.matcher();
        List<ConfigLine> keyLines = lines.stream().filter(line -> line.key().equals(matcher.key())).toList();
        return switch (matcher.type()) {
            case PRESENT -> evaluatePresent(rule, filePath, matcher, keyLines);
            case VALUE_PATTERN -> evaluateValuePattern(rule, filePath, matcher, keyLines);
            case FORBIDDEN -> evaluateForbidden(rule, filePath, keyLines);
        };
    }

    private List<ConfigViolation> evaluatePresent(
            ConfigAuditRule rule, String filePath, ConfigRuleMatcher matcher, List<ConfigLine> keyLines) {
        if (keyLines.isEmpty()) {
            return List.of(violation(rule, filePath, null, "缺少配置键 " + matcher.key()));
        }
        Pattern pattern = compileOrNull(matcher.valuePattern());
        if (pattern == null) {
            return List.of();
        }
        boolean conforming = keyLines.stream().anyMatch(line -> pattern.matcher(line.value()).matches());
        return conforming ? List.of()
                : List.of(violation(rule, filePath, keyLines.getFirst().lineNumber(),
                        "键 " + matcher.key() + " 的值不符合要求"));
    }

    private List<ConfigViolation> evaluateValuePattern(
            ConfigAuditRule rule, String filePath, ConfigRuleMatcher matcher, List<ConfigLine> keyLines) {
        Pattern pattern = compileOrNull(matcher.valuePattern());
        if (pattern == null) {
            return List.of();
        }
        List<ConfigViolation> violations = new ArrayList<>();
        if (matcher.negate()) {
            for (ConfigLine line : keyLines) {
                if (pattern.matcher(line.value()).matches()) {
                    violations.add(violation(rule, filePath, line.lineNumber(), line.key() + " " + line.value()));
                }
            }
            return violations;
        }
        if (keyLines.isEmpty()) {
            return List.of(violation(rule, filePath, null, "缺少配置键 " + matcher.key()));
        }
        boolean anyMatch = keyLines.stream().anyMatch(line -> pattern.matcher(line.value()).matches());
        return anyMatch ? List.of()
                : List.of(violation(rule, filePath, keyLines.getFirst().lineNumber(),
                        "键 " + matcher.key() + " 的值不符合要求"));
    }

    private List<ConfigViolation> evaluateForbidden(
            ConfigAuditRule rule, String filePath, List<ConfigLine> keyLines) {
        List<ConfigViolation> violations = new ArrayList<>();
        for (ConfigLine line : keyLines) {
            if (ENABLED_VALUES.contains(line.value().toLowerCase(Locale.ROOT))) {
                violations.add(violation(rule, filePath, line.lineNumber(), line.key() + " " + line.value()));
            }
        }
        return violations;
    }

    private ConfigViolation violation(
            ConfigAuditRule rule, String filePath, Integer lineNumber, String evidence) {
        return new ConfigViolation(rule.ruleId(), rule.dimension(), rule.severity(), filePath, lineNumber,
                evidence, rule.basis(), rule.remediation());
    }

    private Pattern compileOrNull(String regex) {
        return regex == null || regex.isBlank() ? null : Pattern.compile(regex);
    }
}
