package com.repograph.securityreview;

import com.repograph.core.securityreview.AuditDimension;
import com.repograph.core.securityreview.AuditSeverity;
import com.repograph.core.securityreview.ConfigAuditReport;
import com.repograph.core.securityreview.ConfigAuditRequest;
import com.repograph.core.securityreview.ConfigAuditRule;
import com.repograph.core.securityreview.ConfigRuleMatcher;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link DefaultConfigAuditService} 单元测试，覆盖三类匹配器的命中/未命中路径与规则即数据的扩展性。
 *
 * @author leolu
 * @since 0.9.0
 */
class DefaultConfigAuditServiceTest {

    // ── 规则集加载（真实 classpath 规则） ─────────────────────────────────────

    @Test
    void audit_loadedSecurityPolicyRules_reportsViolation() {
        DefaultConfigAuditService service = new DefaultConfigAuditService();
        ConfigAuditRequest request = new ConfigAuditRequest(
                List.of(file("sshd_config", """
                        #comment
                        PermitRootLogin yes
                        """)),
                List.of(AuditDimension.SECURITY_POLICY));

        ConfigAuditReport report = service.audit(request);

        assertThat(report.dimensionsAudited()).containsExactly(AuditDimension.SECURITY_POLICY);
        assertThat(report.checkedRules()).isGreaterThanOrEqualTo(5);
        assertThat(report.violations())
                .anySatisfy(v -> {
                    assertThat(v.ruleId()).isEqualTo("policy-permit-root-login");
                    assertThat(v.lineNumber()).isEqualTo(2);
                    assertThat(v.evidence()).isEqualTo("PermitRootLogin yes");
                });
    }

    @Test
    void audit_noViolationsOnCleanFile_reportsDimensionWithEmptyViolations() {
        DefaultConfigAuditService service = new DefaultConfigAuditService();
        ConfigAuditRequest request = new ConfigAuditRequest(
                List.of(file("sysctl.conf", "kernel.sysrq = 0\nkernel.kexec_load_disabled = 1\n")),
                List.of(AuditDimension.SYSTEM_CONFIG));

        ConfigAuditReport report = service.audit(request);

        assertThat(report.dimensionsAudited()).containsExactly(AuditDimension.SYSTEM_CONFIG);
        assertThat(report.checkedRules()).isGreaterThanOrEqualTo(1);
        assertThat(report.violations()).isEmpty();
    }

    // ── PRESENT ──────────────────────────────────────────────────────────────

    @Test
    void audit_presentRule_missingKey_reportsViolationWithoutLineNumber() {
        DefaultConfigAuditService service = service(rule(
                ConfigRuleMatcher.MatcherType.PRESENT, "TMOUT", "^[1-9][0-9]*$"));

        ConfigAuditReport report = service.audit(requestOf("profile", "export PATH=/bin\n"));

        assertThat(report.violations()).hasSize(1);
        assertThat(report.violations().getFirst().lineNumber()).isNull();
        assertThat(report.violations().getFirst().evidence()).contains("缺少配置键 TMOUT");
    }

    @Test
    void audit_presentRule_valueConforms_noViolation() {
        DefaultConfigAuditService service = service(rule(
                ConfigRuleMatcher.MatcherType.PRESENT, "TMOUT", "^[1-9][0-9]*$"));

        ConfigAuditReport report = service.audit(requestOf("profile", "# session timeout\nTMOUT = 600\n"));

        assertThat(report.violations()).isEmpty();
    }

    @Test
    void audit_presentRule_valueNotConforming_reportsViolationAtFirstKeyLine() {
        DefaultConfigAuditService service = service(rule(
                ConfigRuleMatcher.MatcherType.PRESENT, "TMOUT", "^[1-9][0-9]*$"));

        ConfigAuditReport report = service.audit(requestOf("profile", "TMOUT=0\n"));

        assertThat(report.violations()).hasSize(1);
        assertThat(report.violations().getFirst().lineNumber()).isEqualTo(1);
        assertThat(report.violations().getFirst().evidence()).contains("不符合要求");
    }

    // ── VALUE_PATTERN ────────────────────────────────────────────────────────

    @Test
    void audit_valuePatternRule_noLineMatches_reportsViolation() {
        DefaultConfigAuditService service = service(rule(
                ConfigRuleMatcher.MatcherType.VALUE_PATTERN, "MaxAuthTries", "^([1-5])$"));

        ConfigAuditReport report = service.audit(requestOf("sshd_config", "MaxAuthTries 10\n"));

        assertThat(report.violations()).hasSize(1);
        assertThat(report.violations().getFirst().severity()).isEqualTo(AuditSeverity.MEDIUM);
    }

    @Test
    void audit_valuePatternNegateRule_matchingValue_reportsViolationPerLine() {
        ConfigAuditRule negateRule = new ConfigAuditRule(
                "deny-ciphers", AuditDimension.SECURITY_POLICY, "禁用弱算法", "依据", AuditSeverity.HIGH,
                "移除 arcfour", new ConfigRuleMatcher(
                        ConfigRuleMatcher.MatcherType.VALUE_PATTERN, "Ciphers", "arcfour", true));
        DefaultConfigAuditService service = service(List.of(negateRule));

        ConfigAuditReport report = service.audit(requestOf("sshd_config", "Ciphers aes256-gcm\nCiphers arcfour\n"));

        assertThat(report.violations()).hasSize(1);
        assertThat(report.violations().getFirst().lineNumber()).isEqualTo(2);
    }

    @Test
    void audit_valuePatternNegateRule_missingKey_compliant() {
        ConfigAuditRule negateRule = new ConfigAuditRule(
                "deny-ciphers", AuditDimension.SECURITY_POLICY, "禁用弱算法", "依据", AuditSeverity.HIGH,
                "移除 arcfour", new ConfigRuleMatcher(
                        ConfigRuleMatcher.MatcherType.VALUE_PATTERN, "Ciphers", "arcfour", true));
        DefaultConfigAuditService service = service(List.of(negateRule));

        ConfigAuditReport report = service.audit(requestOf("sshd_config", "PermitRootLogin no\n"));

        assertThat(report.violations()).isEmpty();
    }

    // ── FORBIDDEN ────────────────────────────────────────────────────────────

    @Test
    void audit_forbiddenRule_disabledValue_compliant() {
        DefaultConfigAuditService service = service(rule(
                ConfigRuleMatcher.MatcherType.FORBIDDEN, "PermitEmptyPasswords", null));

        ConfigAuditReport report = service.audit(requestOf("sshd_config", "PermitEmptyPasswords no\n"));

        assertThat(report.violations()).isEmpty();
    }

    @Test
    void audit_forbiddenRule_missingKey_compliant() {
        DefaultConfigAuditService service = service(rule(
                ConfigRuleMatcher.MatcherType.FORBIDDEN, "PermitEmptyPasswords", null));

        ConfigAuditReport report = service.audit(requestOf("sshd_config", ""));

        assertThat(report.violations()).isEmpty();
    }

    @Test
    void audit_forbiddenRule_quotedEnabledValue_reportsViolation() {
        DefaultConfigAuditService service = service(rule(
                ConfigRuleMatcher.MatcherType.FORBIDDEN, "PermitRootLogin", null));

        ConfigAuditReport report = service.audit(requestOf("sshd_config", "PermitRootLogin \"yes\"\n"));

        assertThat(report.violations()).hasSize(1);
        assertThat(report.violations().getFirst().evidence()).isEqualTo("PermitRootLogin yes");
    }

    // ── 多文件与排序 ─────────────────────────────────────────────────────────

    @Test
    void audit_multipleFiles_violationsSortedByFileAndLine() {
        DefaultConfigAuditService service = service(List.of(
                rule("r1", ConfigRuleMatcher.MatcherType.FORBIDDEN, "PermitRootLogin", null),
                rule("r2", ConfigRuleMatcher.MatcherType.FORBIDDEN, "PermitEmptyPasswords", null)));

        ConfigAuditReport report = service.audit(new ConfigAuditRequest(
                List.of(
                        file("b.conf", "PermitRootLogin yes\nPermitEmptyPasswords yes\n"),
                        file("a.conf", "PermitEmptyPasswords on\n")),
                List.of()));

        assertThat(report.scannedFiles()).isEqualTo(2);
        assertThat(report.checkedRules()).isEqualTo(2);
        assertThat(report.violations())
                .satisfiesExactly(
                        v -> assertThat(v.filePath()).isEqualTo("a.conf"),
                        v -> {
                            assertThat(v.filePath()).isEqualTo("b.conf");
                            assertThat(v.lineNumber()).isEqualTo(1);
                        },
                        v -> {
                            assertThat(v.filePath()).isEqualTo("b.conf");
                            assertThat(v.lineNumber()).isEqualTo(2);
                        });
    }

    // ── 辅助 ─────────────────────────────────────────────────────────────────

    private static DefaultConfigAuditService service(ConfigAuditRule rule) {
        return service(List.of(rule));
    }

    private static DefaultConfigAuditService service(List<ConfigAuditRule> rules) {
        return new DefaultConfigAuditService(rules);
    }

    private static ConfigAuditRule rule(
            ConfigRuleMatcher.MatcherType type, String key, String valuePattern) {
        return rule("rule-" + key, type, key, valuePattern);
    }

    private static ConfigAuditRule rule(
            String ruleId, ConfigRuleMatcher.MatcherType type, String key, String valuePattern) {
        return new ConfigAuditRule(ruleId, AuditDimension.SECURITY_POLICY, "测试规则", "测试依据",
                AuditSeverity.MEDIUM, "整改建议",
                new ConfigRuleMatcher(type, key, valuePattern, false));
    }

    private static ConfigAuditRequest requestOf(String name, String content) {
        return new ConfigAuditRequest(List.of(file(name, content)), List.of());
    }

    private static ConfigAuditRequest.ConfigAuditFile file(String name, String content) {
        return new ConfigAuditRequest.ConfigAuditFile(name, content);
    }
}
