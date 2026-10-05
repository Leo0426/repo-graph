package com.repograph.app.pipeline;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * IncrementalIndexCache 单元测试，使用临时 SQLite 数据库验证增量过滤和缓存持久化。
 *
 * @author leolu
 * @since 0.1.0
 */
class IncrementalIndexCacheTest {

    @TempDir
    Path tempDir;

    private IncrementalIndexCache makeCache() {
        Path dbFile = tempDir.resolve("test-index.db");
        return new IncrementalIndexCache(dbFile.toString());
    }

    private Path writeFile(String name, String content) throws Exception {
        Path file = tempDir.resolve(name);
        Files.writeString(file, content);
        return file;
    }

    @Test
    void dirtyMarkerSurvivesRestartAndRemainsVisibleAfterFileDeletion() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = writeFile("Dirty.java", "class Dirty {}");
        cache.updateEntries(List.of(file), "proj", tempDir);
        cache.markDirty(List.of("Dirty.java", "AlreadyDeleted.java"), "proj");

        IncrementalIndexCache reopened = makeCache();
        assertThat(reopened.filterChanged(List.of(file), "proj", tempDir)).containsExactly(file);
        Files.delete(file);
        assertThat(reopened.findDeletedPaths(List.of(), "proj", tempDir))
                .containsExactly("AlreadyDeleted.java", "Dirty.java");
        assertThat(reopened.findDeletedPaths(List.of(), "other", tempDir)).isEmpty();
    }

    @Test
    void projectDeletionMarkerSurvivesFileCacheCleanupUntilExplicitCompletion() {
        IncrementalIndexCache cache = makeCache();
        cache.markProjectDeletionPending("proj");
        cache.removeProject("proj");

        IncrementalIndexCache reopened = makeCache();
        assertThat(reopened.hasPendingProjectDeletion("proj")).isTrue();
        assertThat(reopened.hasPendingProjectDeletion("other")).isFalse();
        reopened.completeProjectDeletion("proj");
        assertThat(makeCache().hasPendingProjectDeletion("proj")).isFalse();
    }

    @Test
    void unavailableCacheCannotSilentlyAcknowledgeMutation() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = writeFile("Foo.java", "class Foo {}");
        Files.delete(tempDir.resolve("test-index.db"));
        Files.createDirectory(tempDir.resolve("test-index.db"));

        assertThatThrownBy(() -> cache.markDirty(List.of("Foo.java"), "proj"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> cache.updateEntries(List.of(file), "proj", tempDir))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> cache.removeEntry("Foo.java", "proj"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> cache.findDeletedPaths(List.of(), "proj", tempDir))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void sourceDisappearingBeforeCommitKeepsADeletionRetryMarker() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = writeFile("Foo.java", "class Foo {}");
        var snapshot = cache.captureFingerprints(List.of(file));
        Files.delete(file);

        assertThat(cache.updateUnchangedEntries(List.of(file), snapshot, "proj", tempDir)).containsExactly(file);
        assertThat(makeCache().findDeletedPaths(List.of(), "proj", tempDir)).containsExactly("Foo.java");
    }

    // ── filterChanged ─────────────────────────────────────────────────────────

    @Test
    void filterChanged_newFile_returnsFile() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = writeFile("Foo.java", "class Foo {}");

        List<Path> changed = cache.filterChanged(List.of(file), "proj1", tempDir);
        assertThat(changed).containsExactly(file);
    }

    @Test
    void filterChanged_cachedFileUnchanged_returnsEmpty() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = writeFile("Foo.java", "class Foo {}");

        cache.updateEntries(List.of(file), "proj1", tempDir);
        List<Path> changed = cache.filterChanged(List.of(file), "proj1", tempDir);
        assertThat(changed).isEmpty();
    }

    @Test
    void filterChanged_fileContentChanged_returnsFile() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = writeFile("Foo.java", "class Foo {}");
        cache.updateEntries(List.of(file), "proj1", tempDir);

        // Modify file content
        Files.writeString(file, "class Foo { void bar() {} }");

        List<Path> changed = cache.filterChanged(List.of(file), "proj1", tempDir);
        assertThat(changed).containsExactly(file);
    }

    // ── updateEntries → filterChanged persistence ─────────────────────────────

    @Test
    void updateEntries_persistedToDb_filterChangedSkipsFile() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = writeFile("Bar.java", "class Bar {}");
        cache.updateEntries(List.of(file), "projA", tempDir);

        // Create a new cache instance pointing to same DB — tests persistence
        IncrementalIndexCache cache2 = makeCache();
        List<Path> changed = cache2.filterChanged(List.of(file), "projA", tempDir);
        assertThat(changed).isEmpty();
    }

    @Test
    void updateUnchangedEntries_persistsOnlyFilesMatchingTheSnapshot() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path stable = writeFile("Stable.java", "class Stable {}");
        Path changed = writeFile("Changed.java", "class Changed {}");
        var fingerprints = cache.captureFingerprints(List.of(stable, changed));
        Files.writeString(changed, "class Changed { void added() {} }");

        assertThat(cache.updateUnchangedEntries(List.of(stable, changed), fingerprints, "projA", tempDir))
                .containsExactly(changed);

        IncrementalIndexCache reopened = makeCache();
        assertThat(reopened.filterChanged(List.of(stable, changed), "projA", tempDir)).containsExactly(changed);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void updateUnchangedEntries_invalidatesOldFingerprintWhenSourceChangesOrDisappears(boolean deleted)
            throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = writeFile("Foo.java", "class Foo {}");
        cache.updateEntries(List.of(file), "projA", tempDir);
        var fingerprints = cache.captureFingerprints(List.of(file));
        if (deleted) {
            Files.delete(file);
        } else {
            Files.writeString(file, "class Foo { void changed() {} }");
        }

        assertThat(cache.updateUnchangedEntries(List.of(file), fingerprints, "projA", tempDir))
                .containsExactly(file);

        Files.writeString(file, "class Foo {}");
        assertThat(cache.filterChanged(List.of(file), "projA", tempDir)).containsExactly(file);
    }

    @Test
    void updateUnchangedEntries_doesNotCommitSourceThatWasMissingFromSnapshot() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = tempDir.resolve("Late.java");
        var fingerprints = cache.captureFingerprints(List.of(file));
        Files.writeString(file, "class Late {}");

        assertThat(cache.updateUnchangedEntries(List.of(file), fingerprints, "projA", tempDir))
                .containsExactly(file);
        assertThat(cache.filterChanged(List.of(file), "projA", tempDir)).containsExactly(file);
    }

    // ── Multiple files ────────────────────────────────────────────────────────

    @Test
    void filterChanged_onlyChangedFilesReturned() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path a = writeFile("A.java", "class A {}");
        Path b = writeFile("B.java", "class B {}");

        cache.updateEntries(List.of(a, b), "proj1", tempDir);

        // Modify only A
        Files.writeString(a, "class A { int x; }");

        List<Path> changed = cache.filterChanged(List.of(a, b), "proj1", tempDir);
        assertThat(changed).containsExactly(a);
        assertThat(changed).doesNotContain(b);
    }

    // ── Empty input ───────────────────────────────────────────────────────────

    @Test
    void filterChanged_emptyList_returnsEmpty() {
        IncrementalIndexCache cache = makeCache();
        List<Path> changed = cache.filterChanged(List.of(), "proj1", tempDir);
        assertThat(changed).isEmpty();
    }

    // ── Auto-create DB ────────────────────────────────────────────────────────

    @Test
    void constructor_dbNotExists_autoCreatedAndUsable() throws Exception {
        // DB file inside a nested path that doesn't exist yet
        Path dbFile = tempDir.resolve("nested/dir/index.db");
        IncrementalIndexCache cache = new IncrementalIndexCache(dbFile.toString());
        Path file = writeFile("C.java", "class C {}");
        // Should not throw
        List<Path> changed = cache.filterChanged(List.of(file), "proj1", tempDir);
        assertThat(changed).containsExactly(file);
    }

    // ── Project isolation ─────────────────────────────────────────────────────

    @Test
    void filterChanged_differentProjectIds_treatedSeparately() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = writeFile("Shared.java", "class Shared {}");

        cache.updateEntries(List.of(file), "proj-A", tempDir);

        List<Path> changed = cache.filterChanged(List.of(file), "proj-B", tempDir);
        assertThat(changed).containsExactly(file);
    }

    // ── removeEntry ───────────────────────────────────────────────────────────

    @Test
    void removeEntry_removedFileAppearsChangedAgain() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = writeFile("Del.java", "class Del {}");
        cache.updateEntries(List.of(file), "proj1", tempDir);

        // Confirm cached
        assertThat(cache.filterChanged(List.of(file), "proj1", tempDir)).isEmpty();

        // Remove the entry (simulating physical file deletion)
        cache.removeEntry("Del.java", "proj1");

        // Now the same file content is seen as "new" (no cached MD5)
        assertThat(cache.filterChanged(List.of(file), "proj1", tempDir)).containsExactly(file);
    }

    @Test
    void removeEntry_nonExistentEntry_silentlyIgnored() {
        IncrementalIndexCache cache = makeCache();
        // Must not throw
        cache.removeEntry("ghost/File.java", "proj1");
    }

    @Test
    void removeEntry_doesNotAffectOtherProject() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path file = writeFile("Shared.java", "class Shared {}");
        cache.updateEntries(List.of(file), "proj-A", tempDir);
        cache.updateEntries(List.of(file), "proj-B", tempDir);

        cache.removeEntry("Shared.java", "proj-A");

        // proj-B entry untouched
        assertThat(cache.filterChanged(List.of(file), "proj-B", tempDir)).isEmpty();
    }

    @Test
    void findDeletedPaths_returnsCachedFilesMissingFromCurrentScan() throws Exception {
        IncrementalIndexCache cache = makeCache();
        Path kept = writeFile("Kept.java", "class Kept {}");
        Path deleted = writeFile("Deleted.java", "class Deleted {}");
        cache.updateEntries(List.of(kept, deleted), "proj1", tempDir);
        Files.delete(deleted);

        assertThat(cache.findDeletedPaths(List.of(kept), "proj1", tempDir))
                .containsExactly("Deleted.java");
    }
}
