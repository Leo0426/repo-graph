package com.repograph.securityreview;

import com.repograph.core.securityreview.AuditSeverity;
import com.repograph.core.securityreview.ThreatDetectionRequest;
import com.repograph.core.securityreview.ThreatKind;
import com.repograph.core.securityreview.ThreatRecord;
import com.repograph.core.securityreview.ThreatReport;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link DefaultThreatDetectionService} 单元测试，覆盖攻击历史检出、违规外联白名单比对与
 * 正常日志零误报。
 *
 * @author leolu
 * @since 0.9.0
 */
class DefaultThreatDetectionServiceTest {

    private static final String AUTH_LOG = """
            Oct 13 09:10:01 host sshd[1001]: Failed password for root from 203.0.113.9 port 40122 ssh2
            Oct 13 09:10:03 host sshd[1001]: Failed password for root from 203.0.113.9 port 40124 ssh2
            Oct 13 09:10:05 host sshd[1002]: Failed password for invalid user admin from 203.0.113.9 port 40126 ssh2
            Oct 13 09:10:07 host sshd[1002]: Failed password for admin from 203.0.113.9 port 40128 ssh2
            Oct 13 09:10:09 host sshd[1003]: Failed password for root from 203.0.113.9 port 40130 ssh2
            Oct 13 09:12:00 host sudo: pam_unix(sudo:auth): authentication failure; user=deploy
            Oct 13 09:15:00 host sshd[1010]: Invalid user oracle from 198.51.100.7 port 50100 ssh2
            Oct 13 09:16:00 host systemd[1]: Started Daily apt upgrade and clean activities.
            """;

    private static final String OUTBOUND_LOG = """
            Oct 13 10:00:01 host kernel: [UFW BLOCK] IN=eth0 OUT=eth1 SRC=10.0.0.5 DST=8.8.8.8 PROTO=UDP
            Oct 13 10:00:10 host app: outbound connection to 10.0.0.2 succeeded
            Oct 13 10:00:20 host kernel: [UFW BLOCK] IN=eth0 OUT=eth1 SRC=10.0.0.5 DST=192.0.2.44 PROTO=TCP
            """;

    private static final String NORMAL_LOG = """
            Oct 13 11:00:00 host systemd[1]: Started Daily Cleanup of Temporary Directories.
            Oct 13 11:05:00 host sshd[2001]: Accepted password for deploy from 10.0.0.2 port 51222 ssh2
            Oct 13 11:10:00 host CRON[2002]: (root) CMD (command -v debian-sa1 > /dev/null)
            """;

    // ── 真实 classpath 规则 ──────────────────────────────────────────────────

    @Test
    void detect_attackHistoryLog_reportsBruteForceAndProbes() {
        ThreatReport report = detect(requestOf(log("auth.log", AUTH_LOG)));

        assertThat(report.scannedLogs()).isEqualTo(1);
        assertThat(report.records())
                .anySatisfy(r -> {
                    assertThat(r.ruleId()).isEqualTo("attack-brute-force-ssh");
                    assertThat(r.kind()).isEqualTo(ThreatKind.ATTACK_HISTORY);
                    assertThat(r.severity()).isEqualTo(AuditSeverity.HIGH);
                    assertThat(r.detail()).contains("5 次登录失败").contains("root").contains("203.0.113.9");
                    assertThat(r.time()).isEqualTo("Oct 13 09:10:01");
                })
                .anySatisfy(r -> {
                    assertThat(r.ruleId()).isEqualTo("attack-auth-failure");
                    assertThat(r.detail()).contains("deploy");
                })
                .anySatisfy(r -> {
                    assertThat(r.ruleId()).isEqualTo("attack-invalid-user-probe");
                    assertThat(r.time()).isEqualTo("Oct 13 09:15:00");
                });
    }

    @Test
    void detect_outboundLog_reportsOnlyNonWhitelistedDestinations() {
        ThreatReport report = detect(requestOf(
                log("firewall.log", OUTBOUND_LOG),
                "10.0.0.2"));

        assertThat(report.records())
                .extracting(ThreatRecord::evidence)
                .containsExactly(
                        "Oct 13 10:00:01 host kernel: [UFW BLOCK] IN=eth0 OUT=eth1 SRC=10.0.0.5 DST=8.8.8.8 PROTO=UDP",
                        "Oct 13 10:00:20 host kernel: [UFW BLOCK] IN=eth0 OUT=eth1 SRC=10.0.0.5 DST=192.0.2.44 PROTO=TCP");
        assertThat(report.records())
                .allSatisfy(r -> {
                    assertThat(r.kind()).isEqualTo(ThreatKind.VIOLATION_OUTBOUND);
                    assertThat(r.ruleId()).isEqualTo("outbound-iptables-dst");
                });
    }

    @Test
    void detect_normalLog_zeroFalsePositives() {
        ThreatReport report = detect(requestOf(
                log("normal.log", NORMAL_LOG),
                "10.0.0.0/8", "127.0.0.0/8"));

        assertThat(report.records()).isEmpty();
    }

    // ── 白名单语义（显式规则注入，避免依赖具体 classpath 规则集） ─────────────

    @Test
    void detect_whitelistedCidr_exactIp_andNonIpEntry() {
        DefaultThreatDetectionService service = new DefaultThreatDetectionService(List.of(
                spec("out-test", "DST=([0-9.]{7,15})", true, null)));
        ThreatDetectionRequest request = new ThreatDetectionRequest(
                List.of(log("fw.log", """
                        DST=10.1.2.3
                        DST=172.16.5.4
                        DST=192.168.1.1
                        """)),
                List.of("10.0.0.0/8", "172.16.5.4", "example-host"));

        ThreatReport report = service.detect(request);

        assertThat(report.records()).hasSize(1);
        assertThat(report.records().getFirst().detail()).contains("192.168.1.1");
    }

    @Test
    void detect_emptyWhitelist_recordsAllDestinations() {
        DefaultThreatDetectionService service = new DefaultThreatDetectionService(List.of(
                spec("out-test", "DST=([0-9.]{7,15})", true, null)));

        ThreatReport report = service.detect(
                new ThreatDetectionRequest(List.of(log("fw.log", "DST=10.0.0.2\n")), List.of()));

        assertThat(report.records()).hasSize(1);
    }

    @Test
    void detect_aggregateBelowThreshold_noRecord() {
        DefaultThreatDetectionService service = new DefaultThreatDetectionService(List.of(
                spec("attack-test", "Failed password for (\\S+)", false, 5)));

        ThreatReport report = service.detect(requestOf(
                log("auth.log", "Failed password for root\nFailed password for root\n")));

        assertThat(report.records()).isEmpty();
    }

    // ── 辅助 ─────────────────────────────────────────────────────────────────

    private static ThreatReport detect(ThreatDetectionRequest request) {
        return new DefaultThreatDetectionService().detect(request);
    }

    private static ThreatDetectionRequest requestOf(
            ThreatDetectionRequest.ThreatDetectionLog log, String... whitelist) {
        return new ThreatDetectionRequest(List.of(log), List.of(whitelist));
    }

    private static ThreatDetectionRequest.ThreatDetectionLog log(String name, String content) {
        return new ThreatDetectionRequest.ThreatDetectionLog(name, content);
    }

    private static ThreatRuleSpec spec(
            String ruleId, String pattern, boolean whitelistChecked, Integer minCount) {
        return new ThreatRuleSpec(ruleId, ThreatKind.VIOLATION_OUTBOUND, AuditSeverity.HIGH,
                pattern, 1, null, "违规外联：目标 {1}", minCount, whitelistChecked);
    }
}
