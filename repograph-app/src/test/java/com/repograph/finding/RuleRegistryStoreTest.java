package com.repograph.finding;

import com.repograph.core.finding.DetectionRule;
import com.repograph.core.finding.DetectionRuleDraft;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.RuleMatcherKind;
import com.repograph.core.finding.RuleStatus;
import com.repograph.core.finding.RuleTransitionException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link RuleRegistryStore} 的规则发布主路径测试。
 *
 * @author leolu
 */
class RuleRegistryStoreTest {

    @TempDir
    Path tempDir;

    private RuleRegistryStore registry;

    @BeforeEach
    void setUp() {
        registry = new RuleRegistryStore(tempDir.resolve("rules.db").toString());
    }

    @Test
    void publish_whenRegressionSetPasses_activatesVersionOne() {
        DetectionRule candidate = registry.createCandidate(draft("Runtime\\.getRuntime\\(\\)\\.exec"),
                "alice", "initial candidate", "2026-08-01T10:00:00Z");

        assertThat(candidate.version()).isEqualTo(1);
        assertThat(candidate.status()).isEqualTo(RuleStatus.CANDIDATE);

        registry.submitForReview(candidate.ruleId(), candidate.version(),
                "bob", "metadata reviewed", "2026-08-01T10:01:00Z");
        DetectionRule published = registry.publish(candidate.ruleId(), candidate.version(),
                "carol", "samples verified", "2026-08-01T10:02:00Z");

        assertThat(published.status()).isEqualTo(RuleStatus.PUBLISHED);
        assertThat(published.active()).isTrue();
        assertThat(registry.findActive(candidate.ruleId())).contains(published);
        assertThat(registry.audit(candidate.ruleId()))
                .extracting(event -> event.action())
                .containsExactly("CREATED", "SUBMITTED_FOR_REVIEW", "PUBLISHED");
    }

    @Test
    void publish_whenPositiveSampleDoesNotMatch_rejectsWithoutChangingState() {
        DetectionRule candidate = registry.createCandidate(draft("Statement\\.executeQuery"),
                "alice", "candidate", "2026-08-01T10:00:00Z");
        registry.submitForReview(candidate.ruleId(), candidate.version(),
                "bob", "reviewed", "2026-08-01T10:01:00Z");

        assertThatThrownBy(() -> registry.publish(candidate.ruleId(), candidate.version(),
                "carol", "publish", "2026-08-01T10:02:00Z"))
                .isInstanceOf(RuleTransitionException.class)
                .hasMessageContaining("positive sample 0 did not match");

        DetectionRule unchanged = registry.find(candidate.ruleId(), candidate.version()).orElseThrow();
        assertThat(unchanged.status()).isEqualTo(RuleStatus.IN_REVIEW);
        assertThat(unchanged.active()).isFalse();
        assertThat(registry.audit(candidate.ruleId()))
                .extracting(event -> event.action())
                .containsExactly("CREATED", "SUBMITTED_FOR_REVIEW");
    }

    @Test
    void publish_whenNegativeSampleMatches_rejectsFalsePositiveRegression() {
        DetectionRuleDraft draft = new DetectionRuleDraft(
                "java.command-injection", "internal-security-team", List.of("java"), List.of(),
                "CWE-78", ExternalFindingSeverity.HIGH, "Runtime command injection",
                RuleMatcherKind.SUBSTRING, "exec",
                List.of("Runtime.getRuntime().exec(input);"),
                List.of("safeExecutor.exec(validatedConstant);"), "tighten false-positive controls");
        DetectionRule candidate = registry.createCandidate(draft,
                "alice", "candidate", "2026-08-01T10:00:00Z");
        registry.submitForReview(candidate.ruleId(), candidate.version(),
                "bob", "reviewed", "2026-08-01T10:01:00Z");

        assertThatThrownBy(() -> registry.publish(candidate.ruleId(), candidate.version(),
                "carol", "publish", "2026-08-01T10:02:00Z"))
                .isInstanceOf(RuleTransitionException.class)
                .hasMessageContaining("negative sample 0 matched");
    }

    @Test
    void rollback_restoresPreviousPublishedVersionAndAuditsBothVersions() {
        DetectionRule versionOne = publish(draft("Runtime\\.getRuntime\\(\\)\\.exec"),
                "2026-08-01T10:00:00Z");
        DetectionRule versionTwo = publish(draft("Runtime.*exec"),
                "2026-08-01T11:00:00Z");

        assertThat(versionTwo.version()).isEqualTo(2);
        assertThat(registry.find(versionOne.ruleId(), 1).orElseThrow().active()).isFalse();

        DetectionRule restored = registry.rollback(versionOne.ruleId(),
                "dana", "v2 caused regressions", "2026-08-01T12:00:00Z");

        assertThat(restored.version()).isEqualTo(1);
        assertThat(restored.active()).isTrue();
        assertThat(registry.find(versionOne.ruleId(), 2).orElseThrow().status())
                .isEqualTo(RuleStatus.ROLLED_BACK);
        assertThat(registry.audit(versionOne.ruleId()))
                .extracting(event -> event.action())
                .contains("ROLLED_BACK", "RESTORED");
    }

    @Test
    void reject_movesReviewedVersionToRejectedAndRecordsReason() {
        DetectionRule candidate = registry.createCandidate(draft("Runtime.*exec"),
                "alice", "candidate", "2026-08-01T10:00:00Z");
        registry.submitForReview(candidate.ruleId(), candidate.version(),
                "bob", "review", "2026-08-01T10:01:00Z");

        DetectionRule rejected = registry.reject(candidate.ruleId(), candidate.version(),
                "carol", "unsafe matcher", "2026-08-01T10:02:00Z");

        assertThat(rejected.status()).isEqualTo(RuleStatus.REJECTED);
        assertThat(registry.audit(candidate.ruleId()).get(2).reason()).isEqualTo("unsafe matcher");
    }

    private DetectionRule publish(DetectionRuleDraft draft, String baseTime) {
        DetectionRule candidate = registry.createCandidate(draft, "alice", "candidate", baseTime);
        registry.submitForReview(candidate.ruleId(), candidate.version(),
                "bob", "review", baseTime + "-review");
        return registry.publish(candidate.ruleId(), candidate.version(),
                "carol", "publish", baseTime + "-publish");
    }

    private static DetectionRuleDraft draft(String pattern) {
        return new DetectionRuleDraft(
                "java.command-injection",
                "internal-security-team",
                List.of("java"),
                List.of("spring"),
                "CWE-78",
                ExternalFindingSeverity.HIGH,
                "Runtime command injection",
                RuleMatcherKind.REGEX,
                pattern,
                List.of("Runtime.getRuntime().exec(input);"),
                List.of("new ProcessBuilder(command).start();"),
                "initial version");
    }
}
