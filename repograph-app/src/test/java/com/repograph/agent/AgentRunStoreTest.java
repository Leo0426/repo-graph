package com.repograph.agent;

import com.repograph.core.agent.AgentPlaybook;
import com.repograph.core.agent.AgentRun;
import com.repograph.core.agent.AgentRunStatus;
import com.repograph.core.agent.AgentStep;
import com.repograph.core.agent.AgentStepResult;
import com.repograph.core.agent.AgentStepStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link AgentRunStore} 的运行记录与步骤时间线持久化行为测试。
 *
 * @author leolu
 */
class AgentRunStoreTest {

    @TempDir
    Path tempDir;

    private AgentRunStore store;

    @BeforeEach
    void setUp() {
        store = new AgentRunStore(tempDir.resolve("agent-runs.db").toString());
    }

    @Test
    void runTimelineRoundTripsAndListsNewestFirst() {
        store.create(run("run-1", "2026-08-09T01:00:00Z"));
        store.appendStep(step("step-1", "run-1", 1, AgentStepStatus.COMPLETED));
        store.transition("run-1", AgentRunStatus.RUNNING, "", "", "2026-08-09T01:01:00Z");
        store.appendStep(step("step-2", "run-1", 2, AgentStepStatus.SKIPPED));
        store.transition("run-1", AgentRunStatus.WAITING_FOR_REVIEW,
                "snapshot:snap-1", "", "2026-08-09T01:02:00Z");
        store.create(run("run-2", "2026-08-09T02:00:00Z"));

        assertThat(store.get("run-1")).hasValueSatisfying(loaded -> {
            assertThat(loaded.status()).isEqualTo(AgentRunStatus.WAITING_FOR_REVIEW);
            assertThat(loaded.outputReference()).isEqualTo("snapshot:snap-1");
            assertThat(loaded.steps()).extracting(AgentStep::status)
                    .containsExactly(AgentStepStatus.COMPLETED, AgentStepStatus.SKIPPED);
            assertThat(loaded.steps().get(0).evidenceReferences()).containsExactly("finding:fp-1");
            assertThat(loaded.steps().get(0).results()).containsExactly(
                    new AgentStepResult("finding:fp-1", "NEEDS_REVIEW", "TRUE_RISK", 0.15f, true));
        });
        assertThat(store.list("project-1", 10)).extracting(AgentRun::id)
                .containsExactly("run-2", "run-1");
    }

    @Test
    void failedTransitionKeepsStructuredFailureVisible() {
        store.create(run("run-1", "2026-08-09T01:00:00Z"));

        store.transition("run-1", AgentRunStatus.FAILED, "",
                "IMPORT_FAILED: malformed SARIF", "2026-08-09T01:01:00Z");

        assertThat(store.get("run-1")).hasValueSatisfying(loaded -> {
            assertThat(loaded.status()).isEqualTo(AgentRunStatus.FAILED);
            assertThat(loaded.statusReason()).isEqualTo("IMPORT_FAILED: malformed SARIF");
            assertThat(loaded.completedAt()).isEqualTo("2026-08-09T01:01:00Z");
        });
    }

    private static AgentRun run(String id, String createdAt) {
        return new AgentRun(id, "project-1", AgentPlaybook.SAST_TRIAGE, "1",
                AgentRunStatus.QUEUED, "upload:semgrep", "", "",
                createdAt, createdAt, "", List.of());
    }

    private static AgentStep step(
            String id, String runId, int sequence, AgentStepStatus status) {
        return new AgentStep(id, runId, sequence, "IMPORT_FINDINGS", status,
                "导入 1 条报警", List.of("finding:fp-1"), List.of(),
                List.of(new AgentStepResult(
                        "finding:fp-1", "NEEDS_REVIEW", "TRUE_RISK", 0.15f, true)), "",
                "2026-08-09T01:00:00Z", "2026-08-09T01:00:01Z");
    }
}
