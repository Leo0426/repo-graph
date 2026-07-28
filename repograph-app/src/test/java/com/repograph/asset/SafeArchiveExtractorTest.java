package com.repograph.asset;

import com.repograph.core.asset.ArchiveExtractRequest;
import com.repograph.core.asset.ArchiveExtractResult;
import com.repograph.core.asset.ArchiveExtractor;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream;
import org.apache.commons.compress.archivers.zip.UnixStat;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link SafeArchiveExtractor} 的安全归档行为测试。
 *
 * @author leolu
 */
class SafeArchiveExtractorTest {

    @TempDir
    Path tempDir;

    @Test
    void extractZip_stripsSingleRootAndReturnsProjectRoot() throws Exception {
        Path archive = createZip(Map.of(
                "demo/src/Main.java", "class Main {}",
                "demo/README.md", "# Demo"));
        Path destination = tempDir.resolve("asset/source");
        ArchiveExtractor extractor = extractor();

        ArchiveExtractResult result = extractor.extract(
                new ArchiveExtractRequest(archive, destination, Files.size(archive)));

        assertThat(result.archiveType()).isEqualTo("ZIP");
        assertThat(result.projectRoot()).isEqualTo(destination.resolve("demo"));
        assertThat(result.fileCount()).isEqualTo(2);
        assertThat(Files.readString(result.projectRoot().resolve("src/Main.java")))
                .isEqualTo("class Main {}");
    }

    @Test
    void extractTarGz_usesSameResultContract() throws Exception {
        Path archive = createTarGz(Map.of("project/app.py", "print('ok')"));
        Path destination = tempDir.resolve("tar/source");
        ArchiveExtractor extractor = extractor();

        ArchiveExtractResult result = extractor.extract(
                new ArchiveExtractRequest(archive, destination, Files.size(archive)));

        assertThat(result.archiveType()).isEqualTo("TAR_GZ");
        assertThat(result.projectRoot()).isEqualTo(destination.resolve("project"));
        assertThat(Files.readString(result.projectRoot().resolve("app.py")))
                .isEqualTo("print('ok')");
    }

    @Test
    void extractZip_keepsDestinationWhenArchiveHasRootFiles() throws Exception {
        Map<String, String> entries = new LinkedHashMap<>();
        entries.put("README.md", "# Root");
        entries.put("src/Main.java", "class Main {}");
        Path archive = createZip(entries);
        Path destination = tempDir.resolve("mixed/source");

        ArchiveExtractResult result = extractor().extract(
                new ArchiveExtractRequest(archive, destination, Files.size(archive)));

        assertThat(result.projectRoot()).isEqualTo(destination);
    }

    @Test
    void extractZip_rejectsPathTraversalAndRemovesPartialDirectory() throws Exception {
        Path archive = createZip(Map.of("../outside.txt", "escaped"));
        Path destination = tempDir.resolve("unsafe/source");

        assertThatThrownBy(() -> extractor().extract(
                new ArchiveExtractRequest(archive, destination, Files.size(archive))))
                .isInstanceOf(UnsafeArchiveException.class)
                .hasMessageContaining("unsafe");
        assertThat(destination).doesNotExist();
        assertThat(tempDir.resolve("outside.txt")).doesNotExist();
    }

    @Test
    void extractZip_rejectsAbsoluteBackslashTraversalDuplicateAndSymlinkEntries() throws Exception {
        assertUnsafe(createZip(Map.of("/absolute.txt", "x")));
        assertUnsafe(createZip(Map.of("..\\outside.txt", "x")));

        Map<String, String> duplicate = new LinkedHashMap<>();
        duplicate.put("dir\\same.txt", "one");
        duplicate.put("dir/same.txt", "two");
        assertUnsafe(createZip(duplicate));
        assertUnsafe(createZipSymlink());
    }

    @Test
    void extractTarGz_rejectsSymbolicAndHardLinks() throws Exception {
        assertUnsafe(createTarLink(true));
        assertUnsafe(createTarLink(false));
    }

    @Test
    void extractZip_enforcesEntryDepthAndByteLimits() throws Exception {
        assertThatThrownBy(() -> extractWith(
                createZip(Map.of("a/b/file.txt", "x")),
                new ArchiveProperties(tempDir.resolve("managed"), 10, 10, 10, 10, 2)))
                .isInstanceOf(ArchiveLimitException.class);

        Map<String, String> twoFiles = new LinkedHashMap<>();
        twoFiles.put("a.txt", "a");
        twoFiles.put("b.txt", "b");
        assertThatThrownBy(() -> extractWith(
                createZip(twoFiles),
                new ArchiveProperties(tempDir.resolve("managed"), 10, 10, 1, 10, 10)))
                .isInstanceOf(ArchiveLimitException.class);

        String large = "x".repeat(2 * 1024 * 1024);
        assertThatThrownBy(() -> extractWith(
                createZip(Map.of("large.txt", large)),
                new ArchiveProperties(tempDir.resolve("managed"), 10, 10, 10, 1, 10)))
                .isInstanceOf(ArchiveLimitException.class);

        String medium = "x".repeat(700 * 1024);
        Map<String, String> expanded = new LinkedHashMap<>();
        expanded.put("a.txt", medium);
        expanded.put("b.txt", medium);
        assertThatThrownBy(() -> extractWith(
                createZip(expanded),
                new ArchiveProperties(tempDir.resolve("managed"), 10, 1, 10, 1, 10)))
                .isInstanceOf(ArchiveLimitException.class);
    }

    @Test
    void extract_rejectsDeclaredOrActualUploadOverLimit() throws Exception {
        Path archive = createZip(Map.of("file.txt", "x"));
        ArchiveExtractor extractor = new SafeArchiveExtractor(
                new ArchiveProperties(tempDir.resolve("managed"), 1, 10, 10, 10, 10));

        assertThatThrownBy(() -> extractor.extract(
                new ArchiveExtractRequest(archive, tempDir.resolve("declared"), 2 * 1024 * 1024L)))
                .isInstanceOf(ArchiveLimitException.class);

        Path oversized = tempDir.resolve("oversized.zip");
        Files.write(oversized, new byte[2 * 1024 * 1024]);
        assertThatThrownBy(() -> extractor.extract(
                new ArchiveExtractRequest(oversized, tempDir.resolve("actual"), -1)))
                .isInstanceOf(ArchiveLimitException.class);
    }

    private ArchiveExtractor extractor() {
        return new SafeArchiveExtractor(new ArchiveProperties(
                tempDir.resolve("managed"), 200, 1024, 50_000, 50, 32));
    }

    private ArchiveExtractResult extractWith(Path archive, ArchiveProperties properties) throws Exception {
        Path destination = tempDir.resolve("limit-" + System.nanoTime() + "/source");
        return new SafeArchiveExtractor(properties).extract(
                new ArchiveExtractRequest(archive, destination, Files.size(archive)));
    }

    private void assertUnsafe(Path archive) throws Exception {
        Path destination = tempDir.resolve("unsafe-" + System.nanoTime() + "/source");
        assertThatThrownBy(() -> extractor().extract(
                new ArchiveExtractRequest(archive, destination, Files.size(archive))))
                .isInstanceOf(UnsafeArchiveException.class);
        assertThat(destination).doesNotExist();
    }

    private Path createZip(Map<String, String> entries) throws IOException {
        Path archive = tempDir.resolve("fixture-" + System.nanoTime() + ".bin");
        try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(archive))) {
            for (Map.Entry<String, String> entry : entries.entrySet()) {
                out.putNextEntry(new ZipEntry(entry.getKey()));
                out.write(entry.getValue().getBytes(StandardCharsets.UTF_8));
                out.closeEntry();
            }
        }
        return archive;
    }

    private Path createTarGz(Map<String, String> entries) throws IOException {
        Path archive = tempDir.resolve("fixture-" + System.nanoTime() + ".data");
        try (OutputStream file = Files.newOutputStream(archive);
             GzipCompressorOutputStream gzip = new GzipCompressorOutputStream(file);
             TarArchiveOutputStream tar = new TarArchiveOutputStream(gzip)) {
            for (Map.Entry<String, String> item : entries.entrySet()) {
                byte[] content = item.getValue().getBytes(StandardCharsets.UTF_8);
                TarArchiveEntry entry = new TarArchiveEntry(item.getKey());
                entry.setSize(content.length);
                tar.putArchiveEntry(entry);
                tar.write(content);
                tar.closeArchiveEntry();
            }
            tar.finish();
        }
        return archive;
    }

    private Path createZipSymlink() throws IOException {
        Path archive = tempDir.resolve("symlink-" + System.nanoTime() + ".zip");
        try (ZipArchiveOutputStream zip = new ZipArchiveOutputStream(archive)) {
            byte[] target = "../outside".getBytes(StandardCharsets.UTF_8);
            ZipArchiveEntry entry = new ZipArchiveEntry("link");
            entry.setUnixMode(UnixStat.LINK_FLAG | 0777);
            entry.setSize(target.length);
            zip.putArchiveEntry(entry);
            zip.write(target);
            zip.closeArchiveEntry();
            zip.finish();
        }
        return archive;
    }

    private Path createTarLink(boolean symbolic) throws IOException {
        Path archive = tempDir.resolve("link-" + System.nanoTime() + ".tar.gz");
        try (OutputStream file = Files.newOutputStream(archive);
             GzipCompressorOutputStream gzip = new GzipCompressorOutputStream(file);
             TarArchiveOutputStream tar = new TarArchiveOutputStream(gzip)) {
            TarArchiveEntry entry = new TarArchiveEntry(
                    "link", symbolic ? TarArchiveEntry.LF_SYMLINK : TarArchiveEntry.LF_LINK);
            entry.setLinkName("../outside");
            tar.putArchiveEntry(entry);
            tar.closeArchiveEntry();
            tar.finish();
        }
        return archive;
    }
}
