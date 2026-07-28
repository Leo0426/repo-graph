package com.repograph.finding;

import com.repograph.core.finding.RuleSuppression;
import com.repograph.core.finding.RuleSuppressionScope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 规则抑制及审计记录持久化测试。
 *
 * @author leolu
 */
class RuleSuppressionStoreTest {

    @TempDir
    Path tempDir;

    private RuleSuppressionStore store;

    @BeforeEach
    void setUp() {
        store = new RuleSuppressionStore(tempDir.resolve("suppressions.db").toString());
    }

    @Test
    void findActiveHonorsProjectRuleScopeAndExpiry() {
        store.create(suppression(
                "active", RuleSuppressionScope.PROJECT, "", "2026-08-01T00:00:00Z"));
        store.create(suppression(
                "expired", RuleSuppressionScope.PROJECT, "", "2026-07-25T00:00:00Z"));

        assertThat(store.findActive(
                "project-1",
                "java.command-injection",
                "src/main/java/App.java",
                Instant.parse("2026-07-26T00:00:00Z")))
                .hasValueSatisfying(suppression -> assertThat(suppression.id()).isEqualTo("active"));
        assertThat(store.audit("active"))
                .singleElement()
                .satisfies(event -> {
                    assertThat(event.action()).isEqualTo("CREATED");
                    assertThat(event.actor()).isEqualTo("leo");
                    assertThat(event.reason()).isEqualTo("generated fixture is safe");
                });
    }

    @Test
    void fileGlobScopeDoesNotSuppressFilesOutsideScope() {
        store.create(suppression(
                "test-only",
                RuleSuppressionScope.FILE_GLOB,
                "src/test/**",
                "2026-08-01T00:00:00Z"));

        assertThat(store.findActive(
                "project-1",
                "java.command-injection",
                "src/test/java/Fixture.java",
                Instant.parse("2026-07-26T00:00:00Z"))).isPresent();
        assertThat(store.findActive(
                "project-1",
                "java.command-injection",
                "src/main/java/App.java",
                Instant.parse("2026-07-26T00:00:00Z"))).isEmpty();
    }

    @Test
    void revokeDisablesPolicyAndAppendsAuditEvent() {
        store.create(suppression(
                "revoked", RuleSuppressionScope.PROJECT, "", "2026-08-01T00:00:00Z"));

        assertThat(store.revoke(
                "revoked",
                "alice",
                "fixture is now production code",
                "2026-07-26T01:00:00Z")).isTrue();

        assertThat(store.findActive(
                "project-1",
                "java.command-injection",
                "src/main/java/App.java",
                Instant.parse("2026-07-26T02:00:00Z"))).isEmpty();
        assertThat(store.audit("revoked")).extracting(event -> event.action())
                .containsExactly("CREATED", "REVOKED");
    }

    private static RuleSuppression suppression(
            String id,
            RuleSuppressionScope scope,
            String scopeValue,
            String expiresAt) {
        return new RuleSuppression(
                id,
                "project-1",
                "java.command-injection",
                scope,
                scopeValue,
                "generated fixture is safe",
                "leo",
                "2026-07-20T00:00:00Z",
                expiresAt,
                true);
    }
}
