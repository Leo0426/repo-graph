package com.repograph.vuln;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class VulnStoreTest {

    @TempDir
    Path tmpDir;

    private VulnStore store() {
        return new VulnStore(tmpDir.resolve("test.db").toString());
    }

    private VulnFinding finding(String id, String ruleId, String severity, String status) {
        return new VulnFinding(id, "proj-1", ruleId, "CWE-89", severity, status,
                "unit-" + id, "com.example.Foo#bar()", "Foo.java", 10,
                "Title", "Detail", Instant.now().toString());
    }

    @Test
    void upsertAll_and_list() {
        VulnStore s = store();
        s.upsertAll(List.of(
                finding("id-1", "SQL_INJECTION", "HIGH", VulnFinding.SUSPECTED),
                finding("id-2", "WEAK_CRYPTO",   "MEDIUM", VulnFinding.SUSPECTED)));

        List<VulnFinding> result = s.list("proj-1", null, null);
        assertThat(result).hasSize(2);
        assertThat(result).extracting(VulnFinding::ruleId)
                .containsExactlyInAnyOrder("SQL_INJECTION", "WEAK_CRYPTO");
    }

    @Test
    void upsert_preserves_confirmed_status() {
        VulnStore s = store();
        VulnFinding f = finding("id-1", "SQL_INJECTION", "HIGH", VulnFinding.SUSPECTED);
        s.upsertAll(List.of(f));
        s.updateStatus("id-1", VulnFinding.CONFIRMED);

        // Re-upsert same id — ON CONFLICT only updates found_at, not status
        s.upsertAll(List.of(f));

        Optional<VulnFinding> result = s.findById("id-1");
        assertThat(result).isPresent();
        assertThat(result.get().status()).isEqualTo(VulnFinding.CONFIRMED);
    }

    @Test
    void list_filters_by_severity() {
        VulnStore s = store();
        s.upsertAll(List.of(
                finding("id-1", "SQL_INJECTION", "HIGH",   VulnFinding.SUSPECTED),
                finding("id-2", "WEAK_CRYPTO",   "MEDIUM", VulnFinding.SUSPECTED)));

        List<VulnFinding> highs = s.list("proj-1", "HIGH", null);
        assertThat(highs).hasSize(1);
        assertThat(highs.get(0).id()).isEqualTo("id-1");
    }

    @Test
    void list_filters_by_status() {
        VulnStore s = store();
        s.upsertAll(List.of(
                finding("id-1", "SQL_INJECTION", "HIGH", VulnFinding.SUSPECTED),
                finding("id-2", "WEAK_CRYPTO",   "HIGH", VulnFinding.CONFIRMED)));

        List<VulnFinding> confirmed = s.list("proj-1", null, VulnFinding.CONFIRMED);
        assertThat(confirmed).hasSize(1);
        assertThat(confirmed.get(0).id()).isEqualTo("id-2");
    }

    @Test
    void updateStatus_valid() {
        VulnStore s = store();
        s.upsertAll(List.of(finding("id-1", "SQL_INJECTION", "HIGH", VulnFinding.SUSPECTED)));

        boolean updated = s.updateStatus("id-1", VulnFinding.CONFIRMED);
        assertThat(updated).isTrue();

        Optional<VulnFinding> result = s.findById("id-1");
        assertThat(result).isPresent();
        assertThat(result.get().status()).isEqualTo(VulnFinding.CONFIRMED);
    }

    @Test
    void updateStatus_invalid_id() {
        VulnStore s = store();
        boolean updated = s.updateStatus("nonexistent-id", VulnFinding.CONFIRMED);
        assertThat(updated).isFalse();
    }

    @Test
    void findById_not_found() {
        VulnStore s = store();
        Optional<VulnFinding> result = s.findById("no-such-id");
        assertThat(result).isEmpty();
    }

    @Test
    void replaceTaintEvidence_persistsOrderedSourceCodeSteps() {
        VulnStore s = store();
        s.upsertAll(List.of(finding("id-1", "COMMAND_INJECTION_TAINT", "HIGH", VulnFinding.SUSPECTED)));
        List<TaintEvidenceStep> steps = List.of(
                new TaintEvidenceStep(2, "SINK", "com.example.Service#exec(String)",
                        "param[0]", "SINK:exec.arg[0]", "Service.java", 20, 24,
                        "Runtime.getRuntime().exec(command);"),
                new TaintEvidenceStep(1, "SOURCE", "com.example.Controller#run(String)",
                        "param[0]", "process.arg[0]", "Controller.java", 10, 14,
                        "void run(String command) { service.process(command); }"));

        s.replaceTaintEvidence("id-1", steps);

        assertThat(s.findTaintEvidence("id-1"))
                .extracting(TaintEvidenceStep::role)
                .containsExactly("SOURCE", "SINK");
        assertThat(s.findTaintEvidence("id-1").get(1).sourceExcerpt())
                .contains("Runtime.getRuntime().exec");
    }

    @Test
    void removeProject_clears_findings() {
        VulnStore s = store();
        s.upsertAll(List.of(
                finding("id-1", "SQL_INJECTION", "HIGH", VulnFinding.SUSPECTED),
                finding("id-2", "WEAK_CRYPTO",   "HIGH", VulnFinding.SUSPECTED)));
        s.replaceTaintEvidence("id-1", List.of(new TaintEvidenceStep(
                1, "SOURCE", "com.example.Foo#bar()", "param[0]", "return",
                "Foo.java", 10, 12, "return input;")));

        s.removeProject("proj-1");

        assertThat(s.list("proj-1", null, null)).isEmpty();
        assertThat(s.findTaintEvidence("id-1")).isEmpty();
    }
}
