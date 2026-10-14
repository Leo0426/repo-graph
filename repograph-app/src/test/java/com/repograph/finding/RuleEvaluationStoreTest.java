package com.repograph.finding;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.RuleEvaluationHit;
import com.repograph.core.finding.RuleEvaluationReport;
import com.repograph.core.finding.RuleEvaluationRequest;
import com.repograph.core.finding.RuleMetricDelta;
import com.repograph.core.finding.RuleMetricSet;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link RuleEvaluationStore} 的快照持久化与查询测试。
 *
 * @author leolu
 */
class RuleEvaluationStoreTest {

    @TempDir
    Path tempDir;

    private RuleEvaluationStore store;

    @BeforeEach
    void setUp() {
        store = new RuleEvaluationStore(
                tempDir.resolve("rules.db").toString(), new ObjectMapper());
    }

    @Test
    void save_thenList_roundTripsFullReport() {
        RuleEvaluationReport report = report(1, "2026-10-13T08:00:00Z", null);
        store.save(report);

        List<RuleEvaluationReport> listed = store.list("proj-1", "java.command-injection");

        assertThat(listed).hasSize(1);
        RuleEvaluationReport loaded = listed.get(0);
        assertThat(loaded.ruleId()).isEqualTo("java.command-injection");
        assertThat(loaded.version()).isEqualTo(1);
        assertThat(loaded.projectId()).isEqualTo("proj-1");
        assertThat(loaded.generatedAt()).isEqualTo("2026-10-13T08:00:00Z");
        assertThat(loaded.metrics().hits()).isEqualTo(5);
        assertThat(loaded.metrics().confirmationRate()).isEqualTo(0.5);
        assertThat(loaded.metrics().suppressionRate()).isEqualTo(0.2);
        assertThat(loaded.metrics().noContextRate()).isEqualTo(0.4);
        assertThat(loaded.omittedReasons()).containsExactly("评估范围内该规则无命中报警");
        assertThat(loaded.regression()).isEmpty();
    }

    @Test
    void latest_returnsMostRecentByGeneratedAt() {
        store.save(report(1, "2026-10-13T08:00:00Z", null));
        RuleEvaluationReport newer = report(2, "2026-10-13T09:00:00Z", null);
        store.save(newer);

        assertThat(store.latest("proj-1", "java.command-injection"))
                .hasValueSatisfying(latest -> assertThat(latest.generatedAt())
                        .isEqualTo("2026-10-13T09:00:00Z"));
    }

    @Test
    void list_persistsAcrossStoreInstances() {
        RuleEvaluationReport first = report(1, "2026-10-13T08:00:00Z", null);
        RuleEvaluationReport second = report(2, "2026-10-13T09:00:00Z", first);
        store.save(first);
        store.save(second);

        RuleEvaluationStore reopened = new RuleEvaluationStore(
                tempDir.resolve("rules.db").toString(), new ObjectMapper());

        List<RuleEvaluationReport> listed = reopened.list("proj-1", "java.command-injection");
        assertThat(listed).hasSize(2);
        assertThat(listed.get(0).generatedAt()).isEqualTo("2026-10-13T09:00:00Z");
        assertThat(listed.get(0).regression()).hasSize(2);
        RuleMetricDelta hitsDelta = listed.get(0).regression().stream()
                .filter(delta -> delta.metric().equals("hits"))
                .findFirst().orElseThrow();
        assertThat(hitsDelta.previous()).isEqualTo(5.0);
        assertThat(hitsDelta.current()).isEqualTo(3.0);
        assertThat(hitsDelta.delta()).isEqualTo(-2.0);
    }

    @Test
    void list_isScopedByProjectAndRule() {
        store.save(report(1, "2026-10-13T08:00:00Z", null));

        assertThat(store.list("proj-2", "java.command-injection")).isEmpty();
        assertThat(store.list("proj-1", "other.rule")).isEmpty();
    }

    private static RuleEvaluationReport report(int version, String generatedAt,
                                               RuleEvaluationReport previous) {
        RuleMetricSet metrics = new RuleMetricSet(
                5, 2, 2, 1, 0.5, 0.5, 0.2, 0.4);
        List<RuleMetricDelta> regression = previous == null ? List.of() : List.of(
                RuleMetricDelta.of("hits", 5.0, 3.0),
                RuleMetricDelta.of("confirmationRate", previous.metrics().confirmationRate(), 0.75));
        return new RuleEvaluationReport(
                "java.command-injection", version, "proj-1", metrics, regression,
                List.of("评估范围内该规则无命中报警"), generatedAt);
    }
}
