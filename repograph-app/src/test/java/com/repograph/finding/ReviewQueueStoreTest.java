package com.repograph.finding;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.ReportSnapshot;
import com.repograph.core.finding.ReviewQueueEntry;
import com.repograph.core.finding.ReviewStatus;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.finding.TriageVerdict;
import com.repograph.core.retrieval.ContextPack;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link ReviewQueueStore} 审核队列及报告快照持久化行为测试，使用临时 SQLite 文件。
 *
 * @author leolu
 */
class ReviewQueueStoreTest {

    @TempDir
    Path tempDir;

    private ReviewQueueStore store;

    @BeforeEach
    void setUp() {
        store = new ReviewQueueStore(tempDir.resolve("test.db").toString(), new ObjectMapper());
    }

    @Test
    void submitCreatesPendingEntriesAndAppendsSubmittedAudit() {
        ReportSnapshot snapshot = snapshot(
                "snap-1", "project-1", TriageVerdict.TRUE_RISK, ExternalFindingSeverity.HIGH, "cwe-78");

        List<ReviewQueueEntry> entries = store.submit(snapshot);

        assertThat(entries).singleElement().satisfies(entry -> {
            assertThat(entry.snapshotId()).isEqualTo("snap-1");
            assertThat(entry.projectId()).isEqualTo("project-1");
            assertThat(entry.status()).isEqualTo(ReviewStatus.PENDING);
            assertThat(entry.claimedBy()).isEmpty();
        });
        assertThat(store.audit(entries.get(0).id())).singleElement()
                .satisfies(event -> assertThat(event.action()).isEqualTo("SUBMITTED"));
    }

    @Test
    void claimMovesPendingToInReviewAndRecordsActor() {
        String entryId = submitOne("project-1", TriageVerdict.TRUE_RISK, ExternalFindingSeverity.HIGH);

        assertThat(store.claim(entryId, "alice", "2026-07-28T01:00:00Z")).isTrue();

        ReviewQueueEntry claimed = store.list(
                "project-1", null, null, null, null, null, null).get(0);
        assertThat(claimed.status()).isEqualTo(ReviewStatus.IN_REVIEW);
        assertThat(claimed.claimedBy()).isEqualTo("alice");
        assertThat(store.audit(entryId)).extracting(e -> e.action())
                .containsExactly("SUBMITTED", "CLAIMED");
    }

    @Test
    void claimingAlreadyClaimedEntryFailsInsteadOfSilentlyReassigning() {
        String entryId = submitOne("project-1", TriageVerdict.TRUE_RISK, ExternalFindingSeverity.HIGH);
        assertThat(store.claim(entryId, "alice", "2026-07-28T01:00:00Z")).isTrue();

        assertThat(store.claim(entryId, "bob", "2026-07-28T01:05:00Z")).isFalse();

        ReviewQueueEntry entry = store.list(
                "project-1", null, null, null, null, null, null).get(0);
        assertThat(entry.claimedBy()).isEqualTo("alice");
    }

    @Test
    void confirmRequiresInReviewState() {
        String entryId = submitOne("project-1", TriageVerdict.TRUE_RISK, ExternalFindingSeverity.HIGH);

        assertThat(store.confirm(entryId, "alice", "verified sink is reachable",
                "2026-07-28T01:00:00Z")).isFalse();

        assertThat(store.claim(entryId, "alice", "2026-07-28T01:00:00Z")).isTrue();
        assertThat(store.confirm(entryId, "alice", "verified sink is reachable",
                "2026-07-28T01:10:00Z")).isTrue();

        ReviewQueueEntry entry = store.list(
                "project-1", null, null, null, null, null, null).get(0);
        assertThat(entry.status()).isEqualTo(ReviewStatus.CONFIRMED);
        assertThat(store.audit(entryId)).extracting(e -> e.action())
                .containsExactly("SUBMITTED", "CLAIMED", "CONFIRMED");
    }

    @Test
    void returnClearsClaimAndMovesBackToPending() {
        String entryId = submitOne("project-1", TriageVerdict.NEEDS_REVIEW, ExternalFindingSeverity.MEDIUM);
        store.claim(entryId, "alice", "2026-07-28T01:00:00Z");

        assertThat(store.returnToQueue(entryId, "alice", "need more context",
                "2026-07-28T01:20:00Z")).isTrue();

        ReviewQueueEntry entry = store.list(
                "project-1", null, null, null, null, null, null).get(0);
        assertThat(entry.status()).isEqualTo(ReviewStatus.PENDING);
        assertThat(entry.claimedBy()).isEmpty();
    }

    @Test
    void rejectRequiresReasonAndRecordsAuditEvent() {
        String entryId = submitOne("project-1", TriageVerdict.LIKELY_FALSE_POSITIVE, ExternalFindingSeverity.LOW);
        store.claim(entryId, "alice", "2026-07-28T01:00:00Z");

        assertThat(store.reject(entryId, "alice", "confirmed false positive",
                "2026-07-28T01:30:00Z")).isTrue();

        assertThat(store.audit(entryId)).extracting(e -> e.reason())
                .contains("confirmed false positive");
    }

    @Test
    void listFiltersByProjectSeverityVerdictAndStatus() {
        String highEntry = submitOne("project-1", TriageVerdict.TRUE_RISK, ExternalFindingSeverity.HIGH);
        submitOne("project-1", TriageVerdict.LIKELY_FALSE_POSITIVE, ExternalFindingSeverity.LOW);
        submitOne("project-2", TriageVerdict.TRUE_RISK, ExternalFindingSeverity.HIGH);

        List<ReviewQueueEntry> highRisk = store.list(
                "project-1", ExternalFindingSeverity.HIGH, TriageVerdict.TRUE_RISK,
                ReviewStatus.PENDING, null, null, null);

        assertThat(highRisk).extracting(ReviewQueueEntry::id).containsExactly(highEntry);
    }

    @Test
    void getSnapshotRoundTripsPersistedReports() {
        ReportSnapshot snapshot = snapshot(
                "snap-2", "project-1", TriageVerdict.TRUE_RISK, ExternalFindingSeverity.HIGH, "cwe-89");
        store.submit(snapshot);

        assertThat(store.getSnapshot("snap-2")).hasValueSatisfying(loaded -> {
            assertThat(loaded.toolVersion()).isEqualTo("0.5.0");
            assertThat(loaded.reports()).hasSize(1);
            assertThat(loaded.reports().get(0).finding().ruleId()).isEqualTo("cwe-89");
        });
    }

    private String submitOne(String projectId, TriageVerdict verdict, ExternalFindingSeverity severity) {
        ReportSnapshot snapshot = snapshot(
                UUID.randomUUID().toString(), projectId, verdict, severity, "rule-x");
        return store.submit(snapshot).get(0).id();
    }

    private static ReportSnapshot snapshot(
            String snapshotId,
            String projectId,
            TriageVerdict verdict,
            ExternalFindingSeverity severity,
            String ruleId) {
        ExternalFinding finding = new ExternalFinding(
                "semgrep", ruleId, "CWE-78", severity, "command injection",
                "src/Command.java", 5, 5, "run", List.of(), "");
        ContextPack pack = new ContextPack("q", "security", List.of(), List.of(), 100, 0, 0, 0, 0, 0);
        TriageReport report = new TriageReport(
                finding, true, "Command.run", verdict, 0.8f,
                List.of(), List.of(), "fix", "summary", pack);
        return new ReportSnapshot(
                snapshotId, projectId, "1", "0.5.0", "abc123", "rules-v1",
                "2026-07-28T00:00:00Z", List.of(report));
    }
}
