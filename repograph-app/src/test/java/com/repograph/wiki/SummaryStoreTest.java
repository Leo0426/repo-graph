package com.repograph.wiki;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.wiki.SummaryDocument;
import com.repograph.core.wiki.SummaryLevel;
import com.repograph.core.wiki.SummarySection;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link SummaryStore} 单元测试：真实 SQLite（临时目录），验证版本递增、
 * 最新版本查询与 id 回查。
 *
 * @author leolu
 * @since 0.7.0
 */
class SummaryStoreTest {

    @TempDir
    Path tempDir;

    private SummaryStore store;

    @BeforeEach
    void setUp() {
        store = new SummaryStore(tempDir.resolve("test.db").toString(), new ObjectMapper());
    }

    private SummaryDocument doc(String scopeId, SummaryLevel level, int version) {
        return new SummaryDocument(null, "proj1", level, scopeId,
                "标题 " + scopeId + " v" + version,
                List.of(new SummarySection("概述", "内容")), List.of(),
                version, "2026-10-15T10:00:00Z", SummaryDocument.STATUS_COMPLETED);
    }

    @Test
    void nextDocVersion_startsAtOne_andIncrements() {
        assertThat(store.nextDocVersion("proj1", "com.a")).isEqualTo(1);
        store.save(doc("com.a", SummaryLevel.PACKAGE, 1));
        assertThat(store.nextDocVersion("proj1", "com.a")).isEqualTo(2);
        // 不同 scopeId 互不影响
        assertThat(store.nextDocVersion("proj1", "com.b")).isEqualTo(1);
    }

    @Test
    void save_assignsId_andRoundTripsThroughJson() {
        SummaryDocument saved = store.save(doc(SummaryDocument.PROJECT_SCOPE, SummaryLevel.PROJECT, 1));

        assertThat(saved.id()).isNotBlank();
        SummaryDocument loaded = store.findById(saved.id()).orElseThrow();
        assertThat(loaded.projectId()).isEqualTo("proj1");
        assertThat(loaded.level()).isEqualTo(SummaryLevel.PROJECT);
        assertThat(loaded.sections()).hasSize(1);
        assertThat(loaded.sections().get(0).title()).isEqualTo("概述");
    }

    @Test
    void listLatest_returnsNewestVersionPerScope_projectFirst() {
        store.save(doc("com.b", SummaryLevel.PACKAGE, 1));
        store.save(doc("com.a", SummaryLevel.PACKAGE, 1));
        store.save(doc("com.a", SummaryLevel.PACKAGE, 2)); // 旧版本应被 latest 覆盖
        store.save(doc(SummaryDocument.PROJECT_SCOPE, SummaryLevel.PROJECT, 1));

        List<SummaryDocument> latest = store.listLatest("proj1");

        assertThat(latest).hasSize(3);
        assertThat(latest.get(0).level()).isEqualTo(SummaryLevel.PROJECT);
        assertThat(latest.stream()
                .filter(d -> "com.a".equals(d.scopeId()))
                .allMatch(d -> d.docVersion() == 2))
                .isTrue();
        assertThat(latest.stream().filter(d -> "com.a".equals(d.scopeId()))).hasSize(1);
    }

    @Test
    void findById_missing_returnsEmpty() {
        assertThat(store.findById("no-such-id")).isEmpty();
    }

    @Test
    void listLatest_otherProject_isolated() {
        store.save(doc(SummaryDocument.PROJECT_SCOPE, SummaryLevel.PROJECT, 1));
        assertThat(store.listLatest("other-project")).isEmpty();
    }
}
