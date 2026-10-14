package com.repograph.securityreview;

import com.repograph.core.securityreview.AuditDimension;
import com.repograph.core.securityreview.AuditSeverity;
import com.repograph.core.securityreview.ConfigAuditReport;
import com.repograph.core.securityreview.ConfigAuditRequest;
import com.repograph.core.securityreview.ConfigViolation;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link DefaultConfigAuditService} 扩展维度单元测试，验证主机基线、系统配置、系统日志三个
 * 维度的规则集通过 classpath 数据加载生效，不需要修改引擎代码。
 *
 * @author leolu
 * @since 0.9.0
 */
class ConfigAuditDimensionsTest {

    // ── HOST_BASELINE ────────────────────────────────────────────────────────

    @Test
    void audit_hostBaseline_reportsX11ForwardingViolation() {
        ConfigAuditReport report = audit("sshd_config", """
                Protocol 2
                X11Forwarding yes
                PASSWORD_HISTORY 5
                ClientAliveInterval 600
                """, AuditDimension.HOST_BASELINE);

        assertThat(report.dimensionsAudited()).containsExactly(AuditDimension.HOST_BASELINE);
        assertThat(report.violations()).hasSize(1);
        assertThat(report.violations().getFirst().ruleId()).isEqualTo("host-ssh-x11-forwarding");
        assertThat(report.violations().getFirst().severity()).isEqualTo(AuditSeverity.MEDIUM);
    }

    @Test
    void audit_hostBaseline_conformingFile_noViolation() {
        ConfigAuditReport report = audit("sshd_config", """
                Protocol 2
                X11Forwarding no
                PASSWORD_HISTORY 5
                ClientAliveInterval 600
                """, AuditDimension.HOST_BASELINE);

        assertThat(report.violations()).isEmpty();
    }

    // ── SYSTEM_CONFIG ────────────────────────────────────────────────────────

    @Test
    void audit_systemConfig_reportsRedirectAndForwardViolations() {
        ConfigAuditReport report = audit("sysctl.conf", """
                net.ipv4.conf.all.accept_redirects = 1
                net.ipv4.ip_forward = 1
                kernel.sysrq = 0
                kernel.kexec_load_disabled = 1
                """, AuditDimension.SYSTEM_CONFIG);

        assertThat(report.violations())
                .extracting(ConfigViolation::ruleId)
                .containsExactly("sys-accept-redirects", "sys-ip-forward");
    }

    @Test
    void audit_systemConfig_missingKexecRule_reportsMissingKey() {
        ConfigAuditReport report = audit("sysctl.conf", "kernel.sysrq = 0\n", AuditDimension.SYSTEM_CONFIG);

        assertThat(report.violations()).hasSize(1);
        assertThat(report.violations().getFirst().ruleId()).isEqualTo("sys-kexec-disabled");
        assertThat(report.violations().getFirst().lineNumber()).isNull();
    }

    // ── SYSTEM_LOG ───────────────────────────────────────────────────────────

    @Test
    void audit_systemLog_reportsAuditdAndJournaldViolations() {
        ConfigAuditReport report = audit("auditd.conf", """
                max_log_file_action = ROTATE
                Storage = volatile
                """, AuditDimension.SYSTEM_LOG);

        assertThat(report.violations())
                .extracting(ConfigViolation::ruleId)
                .containsExactlyInAnyOrder(
                        "log-auditd-max-file-action", "log-journald-storage", "log-auditd-flush");
    }

    @Test
    void audit_systemLog_conformingFile_noViolation() {
        ConfigAuditReport report = audit("auditd.conf", """
                max_log_file_action = KEEP_LOGS
                Storage = persistent
                flush = incremental_async
                """, AuditDimension.SYSTEM_LOG);

        assertThat(report.violations()).isEmpty();
    }

    // ── 维度过滤 ─────────────────────────────────────────────────────────────

    @Test
    void audit_requestFiltersDimensions_onlyRequestedAudited() {
        DefaultConfigAuditService service = new DefaultConfigAuditService();
        ConfigAuditRequest request = new ConfigAuditRequest(
                List.of(file("sshd_config", """
                        Protocol 2
                        PASSWORD_HISTORY 5
                        ClientAliveInterval 600
                        X11Forwarding yes
                        """)),
                List.of(AuditDimension.HOST_BASELINE, AuditDimension.SECURITY_POLICY));

        ConfigAuditReport report = service.audit(request);

        assertThat(report.dimensionsAudited())
                .containsExactlyInAnyOrder(AuditDimension.HOST_BASELINE, AuditDimension.SECURITY_POLICY);
        assertThat(report.violations()).isNotEmpty();
        // 所有违规都属于被请求的维度（SYSTEM_CONFIG/SYSTEM_LOG 未请求，不出现）
        assertThat(report.violations())
                .allSatisfy(v -> assertThat(v.dimension())
                        .isIn(AuditDimension.HOST_BASELINE, AuditDimension.SECURITY_POLICY));
        assertThat(report.violations())
                .anySatisfy(v -> assertThat(v.ruleId()).isEqualTo("host-ssh-x11-forwarding"));
    }

    @Test
    void audit_allLoadedDimensionsAuditedWhenNoFilter() {
        DefaultConfigAuditService service = new DefaultConfigAuditService();

        ConfigAuditReport report = service.audit(
                new ConfigAuditRequest(List.of(file("empty.conf", "")), List.of()));

        assertThat(report.dimensionsAudited()).containsExactlyInAnyOrder(
                AuditDimension.SECURITY_POLICY,
                AuditDimension.HOST_BASELINE,
                AuditDimension.SYSTEM_CONFIG,
                AuditDimension.SYSTEM_LOG);
        assertThat(report.checkedRules()).isEqualTo(16);
    }

    // ── 辅助 ─────────────────────────────────────────────────────────────────

    private static ConfigAuditReport audit(String name, String content, AuditDimension dimension) {
        return new DefaultConfigAuditService().audit(
                new ConfigAuditRequest(
                        List.of(new ConfigAuditRequest.ConfigAuditFile(name, content)),
                        List.of(dimension)));
    }

    private static ConfigAuditRequest.ConfigAuditFile file(String name, String content) {
        return new ConfigAuditRequest.ConfigAuditFile(name, content);
    }
}
