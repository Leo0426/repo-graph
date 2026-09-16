package com.repograph.app.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.agent.AgentRunStore;
import com.repograph.app.pipeline.IndexHistoryStore;
import com.repograph.asset.ImportedAssetStore;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.scanner.ScanTask;
import com.repograph.core.scanner.ScanTaskStatus;
import com.repograph.scanner.ScanTaskStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.time.Clock;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class InterruptedTaskRecoveryTest {
    @TempDir
    Path directory;

    @Test
    void restartAllowsExplicitRetryWithoutReplayingCompletedWork() {
        String database = directory.resolve("jobs.db").toString();
        AgentRunStore agents = new AgentRunStore(database);
        ScanTaskStore scans = new ScanTaskStore(database, new ObjectMapper());
        IndexHistoryStore indexes = new IndexHistoryStore(database);
        ImportedAssetStore assets = new ImportedAssetStore(database);
        String now = "2026-09-16T00:00:00Z";
        scans.create(new ScanTask("queued", "p", "asset", List.of("SEMGREP"), List.of("java"), 30,
                ScanTaskStatus.QUEUED, 1, "", "", now, now));
        scans.create(new ScanTask("cancelled", "p", "asset", List.of("SEMGREP"), List.of("java"), 30,
                ScanTaskStatus.CANCELLED, 1, "", "", now, now));
        assertThat(indexes.tryStart("/project")).isTrue();
        assertThat(indexes.tryStart("/project")).isFalse();
        assertThat(indexes.load("/project").orElseThrow().result()).isNull();
        indexes.save("/completed", "done", null);
        assets.save(new ImportedAsset("asset", "p", "source.zip", "zip", directory,
                AssetStatus.INDEXING, "", now, now, null));

        new InterruptedTaskRecovery(agents, scans, indexes, assets, Clock.systemUTC()).recover();

        assertThat(scans.find("queued").orElseThrow().status()).isEqualTo(ScanTaskStatus.FAILED);
        assertThat(scans.find("queued").orElseThrow().error()).isEqualTo("PROCESS_INTERRUPTED");
        assertThat(scans.find("cancelled").orElseThrow().status()).isEqualTo(ScanTaskStatus.CANCELLED);
        assertThat(indexes.load("/project").orElseThrow().status()).isEqualTo("error: PROCESS_INTERRUPTED");
        assertThat(indexes.load("/completed").orElseThrow().status()).isEqualTo("done");
        assertThat(indexes.tryStart("/project")).isTrue();
        assertThat(scans.prepareRetry("queued", now)).isTrue();
        assertThat(assets.findById("asset").orElseThrow().status()).isEqualTo(AssetStatus.FAILED);
        assertThat(directory).exists();
    }
}
