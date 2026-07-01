package com.repograph.vuln;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class AdvisoryStoreTest {

    @TempDir
    Path tmpDir;

    private AdvisoryStore store() {
        return new AdvisoryStore(tmpDir.resolve("test.db").toString(), new ObjectMapper());
    }

    private AdvisoryStore.Advisory advisory(String id, String groupId, String artifactId) {
        return new AdvisoryStore.Advisory(id, "Test summary", "HIGH", "CWE-502",
                groupId, artifactId, "1.0.0", "2.0.0", "test");
    }

    @Test
    void seed_on_empty_table() {
        AdvisoryStore s = store();
        assertThat(s.listAll().size()).isGreaterThanOrEqualTo(1);
    }

    @Test
    void importAdvisories_dedup() {
        AdvisoryStore s = store();
        AdvisoryStore.Advisory adv = advisory("CVE-TEST-001", "com.example", "lib-a");

        int first  = s.importAdvisories(List.of(adv));
        int second = s.importAdvisories(List.of(adv));

        assertThat(first).isEqualTo(1);
        assertThat(second).isEqualTo(0);
    }

    @Test
    void findByCoordinate_match() {
        AdvisoryStore s = store();
        s.importAdvisories(List.of(advisory("CVE-TEST-002", "com.example", "lib-b")));

        List<AdvisoryStore.Advisory> result = s.findByCoordinate("com.example", "lib-b");
        assertThat(result).hasSize(1);
        assertThat(result.get(0).id()).isEqualTo("CVE-TEST-002");
    }

    @Test
    void findByCoordinate_no_match() {
        AdvisoryStore s = store();
        s.importAdvisories(List.of(advisory("CVE-TEST-003", "com.example", "lib-c")));

        List<AdvisoryStore.Advisory> result = s.findByCoordinate("com.example", "lib-other");
        assertThat(result).isEmpty();
    }

    @Test
    void importAdvisories_different_artifact_same_id() {
        AdvisoryStore s = store();
        // Same CVE id but different artifactId — both should be inserted (PK is id+groupId+artifactId)
        AdvisoryStore.Advisory adv1 = advisory("CVE-TEST-004", "com.example", "lib-d1");
        AdvisoryStore.Advisory adv2 = advisory("CVE-TEST-004", "com.example", "lib-d2");

        int count = s.importAdvisories(List.of(adv1, adv2));
        assertThat(count).isEqualTo(2);

        assertThat(s.findByCoordinate("com.example", "lib-d1")).hasSize(1);
        assertThat(s.findByCoordinate("com.example", "lib-d2")).hasSize(1);
    }
}
