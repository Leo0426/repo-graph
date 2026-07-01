package com.repograph.app.pipeline;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

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
