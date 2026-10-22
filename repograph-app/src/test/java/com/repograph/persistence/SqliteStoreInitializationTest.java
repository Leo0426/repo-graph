package com.repograph.persistence;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.advisory.LlmAdvisorySettingsStore;
import com.repograph.agent.AgentRunStore;
import com.repograph.app.pipeline.IncrementalIndexCache;
import com.repograph.app.pipeline.IndexHistoryStore;
import com.repograph.asset.ImportedAssetStore;
import com.repograph.finding.ReviewQueueStore;
import com.repograph.finding.RuleEvaluationStore;
import com.repograph.finding.RuleRegistryStore;
import com.repograph.finding.RuleSuppressionStore;
import com.repograph.finding.TriageFeedbackStore;
import com.repograph.scanner.ScannerRunStore;
import com.repograph.scanner.ScanTaskStore;
import com.repograph.vuln.AdvisoryStore;
import com.repograph.vuln.VulnStore;
import com.repograph.wiki.SummaryGenerationCache;
import com.repograph.wiki.SummaryStore;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.function.Function;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 每个 SQLite 存储均可成为首次启动时第一个初始化的存储。
 *
 * @author leolu
 */
class SqliteStoreInitializationTest {

    @TempDir
    Path temporaryDirectory;

    @ParameterizedTest(name = "{0}: missing parents")
    @MethodSource("stores")
    void createsMissingParentsAndKeepsExistingData(String name, Function<String, ?> create, String table)
            throws Exception {
        Path database = temporaryDirectory.resolve("new-home/.repograph/nested/index.db");
        assertThat(database.getParent()).doesNotExist();

        create.apply(database.toString());

        assertThat(database).isRegularFile();
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database);
             var query = connection.prepareStatement("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")) {
            query.setString(1, table);
            try (var rows = query.executeQuery()) {
                assertThat(rows.next()).as("schema for %s", name).isTrue();
            }
            try (var statement = connection.createStatement()) {
                statement.execute("CREATE TABLE preserved_data (value TEXT NOT NULL)");
                statement.execute("INSERT INTO preserved_data VALUES ('keep me')");
            }
        }

        create.apply(database.toString());

        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database);
             var statement = connection.createStatement();
             var rows = statement.executeQuery("SELECT value FROM preserved_data")) {
            assertThat(rows.next()).isTrue();
            assertThat(rows.getString(1)).isEqualTo("keep me");
        }
    }

    @ParameterizedTest(name = "{0}: blocked parent")
    @MethodSource("stores")
    void failsClearlyWhenParentIsAFile(String name, Function<String, ?> create, String table) throws Exception {
        Path blocked = temporaryDirectory.resolve(".repograph");
        Files.writeString(blocked, "existing file");

        assertThatThrownBy(() -> create.apply(blocked.resolve("nested/index.db").toString()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("SQLite")
                .hasMessageContaining(blocked.toString())
                .hasCauseInstanceOf(java.io.IOException.class);
        assertThat(Files.readString(blocked)).isEqualTo("existing file");
    }

    private static Stream<Arguments> stores() {
        ObjectMapper mapper = new ObjectMapper();
        return Stream.of(
                store("settings", path -> new LlmAdvisorySettingsStore(path, false,
                        "http://localhost:11434", "fixture"), "llm_advisory_settings"),
                store("agent", AgentRunStore::new, "agent_runs"),
                store("index history", IndexHistoryStore::new, "index_history"),
                store("incremental cache", IncrementalIndexCache::new, "file_cache"),
                store("assets", ImportedAssetStore::new, "imported_assets"),
                store("review queue", path -> new ReviewQueueStore(path, mapper), "report_snapshots"),
                store("rule evaluations", path -> new RuleEvaluationStore(path, mapper), "rule_evaluations"),
                store("rule registry", RuleRegistryStore::new, "detection_rule_versions"),
                store("rule suppressions", RuleSuppressionStore::new, "rule_suppressions"),
                store("triage feedback", TriageFeedbackStore::new, "triage_feedback"),
                store("scanner runs", path -> new ScannerRunStore(path, mapper), "scanner_runs"),
                store("scan tasks", path -> new ScanTaskStore(path, mapper), "scan_tasks"),
                store("advisories", path -> new AdvisoryStore(path, mapper), "advisories"),
                store("vulnerabilities", VulnStore::new, "vuln_findings"),
                store("summaries", path -> new SummaryStore(path, mapper), "summaries"),
                store("summary cache", path -> new SummaryGenerationCache(path, mapper), "summary_generation_cache"));
    }

    private static Arguments store(String name, Function<String, ?> create, String table) {
        return Arguments.of(name, create, table);
    }
}
