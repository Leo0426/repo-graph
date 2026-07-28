package com.repograph.asset;

import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ImportedAsset;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link ImportedAssetStore} 持久化契约测试。
 *
 * @author leolu
 */
class ImportedAssetStoreTest {

    @TempDir
    Path tempDir;

    @Test
    void assetCanBeRecoveredByIdAndProjectAfterStoreRecreation() {
        Path db = tempDir.resolve("index.db");
        ImportedAsset asset = new ImportedAsset(
                "asset-1", "project-1", "source.zip", "ZIP",
                tempDir.resolve("assets/asset-1/source"),
                AssetStatus.INDEXING, "", "2026-07-26T10:00:00Z", "2026-07-26T10:00:00Z", null);
        ImportedAssetStore first = new ImportedAssetStore(db.toString());
        first.save(asset);

        ImportedAssetStore reopened = new ImportedAssetStore(db.toString());

        assertThat(reopened.findById("asset-1")).contains(asset);
        assertThat(reopened.findByProjectId("project-1")).contains(asset);
    }

    @Test
    void statusCanBeUpdatedAndRecordDeleted() {
        Path db = tempDir.resolve("index.db");
        ImportedAssetStore store = new ImportedAssetStore(db.toString());
        ImportedAsset asset = new ImportedAsset(
                "asset-2", "project-2", "source.tar.gz", "TAR_GZ",
                tempDir.resolve("assets/asset-2/source"),
                AssetStatus.INDEXING, "", "2026-07-26T10:00:00Z", "2026-07-26T10:00:00Z", null);
        store.save(asset);

        store.updateStatus("asset-2", AssetStatus.FAILED, "index failed");

        assertThat(store.findById("asset-2")).get()
                .extracting(ImportedAsset::status, ImportedAsset::error)
                .containsExactly(AssetStatus.FAILED, "index failed");
        store.delete("asset-2");
        assertThat(store.findById("asset-2")).isEmpty();
    }
}
