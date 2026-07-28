package com.repograph.finding;

import com.repograph.core.finding.TriageFeedback;
import com.repograph.core.finding.TriageFeedbackStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link TriageFeedbackStore} 持久化行为测试，使用临时 SQLite 文件。
 *
 * @author leolu
 */
class TriageFeedbackStoreTest {

    @TempDir
    Path tempDir;

    private TriageFeedbackStore store;

    @BeforeEach
    void setUp() {
        store = new TriageFeedbackStore(tempDir.resolve("test.db").toString());
    }

    @Test
    void upsert_isIdempotentAndOverwritesOnSameFingerprint() {
        store.upsert(feedback("fp-1", TriageFeedbackStatus.NEEDS_REVIEW, "初判待复核"));
        store.upsert(feedback("fp-1", TriageFeedbackStatus.FALSE_POSITIVE, "有输入校验"));

        List<TriageFeedback> all = store.list("p1", null);
        assertThat(all).singleElement().satisfies(f -> {
            assertThat(f.status()).isEqualTo(TriageFeedbackStatus.FALSE_POSITIVE);
            assertThat(f.reason()).isEqualTo("有输入校验");
        });
    }

    @Test
    void list_filtersByProjectAndStatus() {
        store.upsert(feedback("fp-1", TriageFeedbackStatus.TRUE_POSITIVE, ""));
        store.upsert(feedback("fp-2", TriageFeedbackStatus.FALSE_POSITIVE, ""));
        store.upsert(new TriageFeedback("fp-3", "p2",
                TriageFeedbackStatus.TRUE_POSITIVE, "leo", "", "2026-07-10T10:00:00Z"));

        assertThat(store.list("p1", null)).hasSize(2);
        assertThat(store.list("p1", TriageFeedbackStatus.TRUE_POSITIVE))
                .singleElement()
                .satisfies(f -> assertThat(f.fingerprint()).isEqualTo("fp-1"));
        assertThat(store.list("p2", null)).hasSize(1);
    }

    @Test
    void findByFingerprint_returnsRecordOrEmpty() {
        store.upsert(feedback("fp-1", TriageFeedbackStatus.FIXED, "已改用 ProcessBuilder"));

        assertThat(store.findByFingerprint("fp-1")).hasValueSatisfying(f -> {
            assertThat(f.status()).isEqualTo(TriageFeedbackStatus.FIXED);
            assertThat(f.reviewer()).isEqualTo("leo");
        });
        assertThat(store.findByFingerprint("missing")).isEmpty();
    }

    @Test
    void sameFingerprintIsProjectScopedAndVersionsArePersisted() {
        store.upsert(new TriageFeedback(
                "fp-shared", "p1", TriageFeedbackStatus.FALSE_POSITIVE,
                "leo", "p1 feedback", "commit-1", "rules-1", "2026-07-10T12:00:00Z"));
        store.upsert(new TriageFeedback(
                "fp-shared", "p2", TriageFeedbackStatus.TRUE_POSITIVE,
                "alice", "p2 feedback", "commit-2", "rules-2", "2026-07-10T13:00:00Z"));

        assertThat(store.findByFingerprint("p1", "fp-shared")).hasValueSatisfying(feedback -> {
            assertThat(feedback.status()).isEqualTo(TriageFeedbackStatus.FALSE_POSITIVE);
            assertThat(feedback.codeVersion()).isEqualTo("commit-1");
            assertThat(feedback.ruleVersion()).isEqualTo("rules-1");
        });
        assertThat(store.findByFingerprint("p2", "fp-shared")).hasValueSatisfying(feedback -> {
            assertThat(feedback.status()).isEqualTo(TriageFeedbackStatus.TRUE_POSITIVE);
            assertThat(feedback.codeVersion()).isEqualTo("commit-2");
            assertThat(feedback.ruleVersion()).isEqualTo("rules-2");
        });
    }

    @Test
    void legacyFingerprintPrimaryKeyIsMigratedWithoutLosingFeedback() throws Exception {
        Path legacyDb = tempDir.resolve("legacy.db");
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + legacyDb);
             var statement = connection.createStatement()) {
            statement.execute("""
                    CREATE TABLE triage_feedback (
                        fingerprint TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        status TEXT NOT NULL,
                        reviewer TEXT NOT NULL,
                        reason TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """);
            statement.execute("""
                    INSERT INTO triage_feedback
                    VALUES ('legacy-fp', 'p1', 'FALSE_POSITIVE', 'leo', 'legacy', '2026-07-01T00:00:00Z')
                    """);
        }

        TriageFeedbackStore migrated = new TriageFeedbackStore(legacyDb.toString());

        assertThat(migrated.findByFingerprint("p1", "legacy-fp")).hasValueSatisfying(feedback -> {
            assertThat(feedback.reason()).isEqualTo("legacy");
            assertThat(feedback.codeVersion()).isEmpty();
            assertThat(feedback.ruleVersion()).isEmpty();
        });
        migrated.upsert(new TriageFeedback(
                "legacy-fp", "p2", TriageFeedbackStatus.TRUE_POSITIVE,
                "alice", "other project", "commit-2", "rules-2", "2026-07-02T00:00:00Z"));
        assertThat(migrated.list("p1", null)).hasSize(1);
        assertThat(migrated.list("p2", null)).hasSize(1);
    }

    @Test
    void parse_rejectsInvalidStatusWithClearMessage() {
        assertThatThrownBy(() -> TriageFeedbackStatus.parse("WONT_FIX"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("WONT_FIX")
                .hasMessageContaining("TRUE_POSITIVE");
        assertThatThrownBy(() -> TriageFeedbackStatus.parse(null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(TriageFeedbackStatus.parse("fixed")).isEqualTo(TriageFeedbackStatus.FIXED);
    }

    private static TriageFeedback feedback(String fingerprint, TriageFeedbackStatus status,
                                           String reason) {
        return new TriageFeedback(fingerprint, "p1", status, "leo", reason,
                "2026-07-10T12:00:00Z");
    }
}
