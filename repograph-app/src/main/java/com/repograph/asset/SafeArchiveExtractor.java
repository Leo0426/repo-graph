package com.repograph.asset;

import com.repograph.core.asset.ArchiveExtractRequest;
import com.repograph.core.asset.ArchiveExtractResult;
import com.repograph.core.asset.ArchiveExtractor;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipFile;
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream;
import org.springframework.stereotype.Service;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.HashSet;
import java.util.Enumeration;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

/**
 * ZIP/TAR.GZ 安全流式提取器。
 *
 * @author leolu
 */
@Service
public class SafeArchiveExtractor implements ArchiveExtractor {

    private static final int BUFFER_SIZE = 8192;
    private static final int ZIP_LOCAL_FILE = 0x04034b50;
    private static final int ZIP_EMPTY = 0x06054b50;
    private static final int ZIP_SPANNED = 0x08074b50;

    private final ArchiveProperties properties;

    /**
     * 创建安全归档提取器。
     *
     * @param properties 归档安全配置
     */
    public SafeArchiveExtractor(ArchiveProperties properties) {
        this.properties = properties;
    }

    @Override
    public ArchiveExtractResult extract(ArchiveExtractRequest request) {
        validateRequest(request);
        Path destination = request.destination().toAbsolutePath().normalize();
        try {
            Files.createDirectories(destination);
            ArchiveType type = detect(request.archivePath());
            ExtractionCounter counter = new ExtractionCounter();
            Set<Path> seenTargets = new HashSet<>();
            if (type == ArchiveType.ZIP) {
                extractZip(request.archivePath(), destination, seenTargets, counter);
            } else {
                extractTarGz(request.archivePath(), destination, seenTargets, counter);
            }
            if (counter.files == 0) {
                throw new InvalidArchiveException("Archive contains no regular files");
            }
            return new ArchiveExtractResult(
                    type.externalName, selectProjectRoot(destination), counter.files, counter.totalBytes);
        } catch (ArchiveLimitException | UnsafeArchiveException
                 | UnsupportedArchiveException | InvalidArchiveException e) {
            cleanupAfterFailure(destination, e);
            throw e;
        } catch (IOException e) {
            cleanupAfterFailure(destination, e);
            throw new InvalidArchiveException("Archive is corrupt or unreadable", e);
        } catch (RuntimeException e) {
            cleanupAfterFailure(destination, e);
            throw e;
        }
    }

    private void validateRequest(ArchiveExtractRequest request) {
        if (request == null || request.archivePath() == null || request.destination() == null) {
            throw new IllegalArgumentException("Archive path and destination are required");
        }
        long declared = request.contentLength();
        if (declared > properties.maxUploadBytes()) {
            throw new ArchiveLimitException("Archive exceeds max upload size");
        }
        try {
            if (!Files.isRegularFile(request.archivePath())) {
                throw new InvalidArchiveException("Archive file does not exist");
            }
            if (Files.size(request.archivePath()) > properties.maxUploadBytes()) {
                throw new ArchiveLimitException("Archive exceeds max upload size");
            }
        } catch (IOException e) {
            throw new InvalidArchiveException("Cannot inspect archive file", e);
        }
    }

    private ArchiveType detect(Path archive) throws IOException {
        byte[] header = new byte[4];
        try (InputStream in = Files.newInputStream(archive)) {
            int read = in.read(header);
            if (read < 2) {
                throw new InvalidArchiveException("Archive is empty or truncated");
            }
        }
        int signature = (header[0] & 0xff)
                | ((header[1] & 0xff) << 8)
                | ((header[2] & 0xff) << 16)
                | ((header[3] & 0xff) << 24);
        if (signature == ZIP_LOCAL_FILE || signature == ZIP_EMPTY || signature == ZIP_SPANNED) {
            return ArchiveType.ZIP;
        }
        if ((header[0] & 0xff) == 0x1f && (header[1] & 0xff) == 0x8b) {
            return ArchiveType.TAR_GZ;
        }
        throw new UnsupportedArchiveException("Only ZIP and TAR.GZ archives are supported");
    }

    private void extractZip(Path archive, Path destination, Set<Path> seen,
                            ExtractionCounter counter) throws IOException {
        try (ZipFile zip = ZipFile.builder().setPath(archive).get()) {
            Enumeration<ZipArchiveEntry> entries = zip.getEntries();
            while (entries.hasMoreElements()) {
                ZipArchiveEntry entry = entries.nextElement();
                countEntry(counter);
                if (!zip.canReadEntryData(entry)) {
                    throw new InvalidArchiveException("ZIP entry uses an unsupported feature");
                }
                if (entry.isUnixSymlink()) {
                    throw new UnsafeArchiveException("Archive contains unsafe symbolic link");
                }
                Path target = resolveTarget(destination, entry.getName(), seen);
                if (entry.isDirectory()) {
                    Files.createDirectories(target);
                } else {
                    try (InputStream input = zip.getInputStream(entry)) {
                        writeRegularFile(input, target, counter);
                    }
                }
            }
        }
    }

    private void extractTarGz(Path archive, Path destination, Set<Path> seen,
                              ExtractionCounter counter) throws IOException {
        try (InputStream raw = new BufferedInputStream(Files.newInputStream(archive));
             GzipCompressorInputStream gzip = new GzipCompressorInputStream(raw);
             TarArchiveInputStream tar = new TarArchiveInputStream(gzip)) {
            TarArchiveEntry entry;
            while ((entry = tar.getNextEntry()) != null) {
                countEntry(counter);
                if (entry.isSymbolicLink() || entry.isLink()) {
                    throw new UnsafeArchiveException("Archive contains unsafe link");
                }
                Path target = resolveTarget(destination, entry.getName(), seen);
                if (entry.isDirectory()) {
                    Files.createDirectories(target);
                } else if (entry.isFile()) {
                    writeRegularFile(tar, target, counter);
                } else {
                    throw new UnsafeArchiveException("Archive contains unsupported special entry");
                }
            }
        }
    }

    private Path resolveTarget(Path destination, String rawName, Set<Path> seen) {
        if (rawName == null || rawName.isBlank() || rawName.indexOf('\0') >= 0) {
            throw new UnsafeArchiveException("Archive contains unsafe empty path");
        }
        String name = rawName.replace('\\', '/');
        if (name.startsWith("/") || name.startsWith("//") || name.matches("^[A-Za-z]:.*")) {
            throw new UnsafeArchiveException("Archive contains unsafe absolute path");
        }
        String[] segments = name.split("/");
        int depth = 0;
        for (String segment : segments) {
            if (segment.isEmpty() || ".".equals(segment)) {
                continue;
            }
            if ("..".equals(segment)) {
                throw new UnsafeArchiveException("Archive contains unsafe parent traversal");
            }
            depth++;
        }
        if (depth == 0 || depth > properties.maxDepth()) {
            if (depth > properties.maxDepth()) {
                throw new ArchiveLimitException("Archive entry exceeds max directory depth");
            }
            throw new UnsafeArchiveException("Archive contains unsafe empty path");
        }
        try {
            Path target = destination.resolve(name).normalize();
            if (!target.startsWith(destination)) {
                throw new UnsafeArchiveException("Archive entry escapes destination");
            }
            if (!seen.add(target)) {
                throw new UnsafeArchiveException("Archive contains duplicate target path");
            }
            return target;
        } catch (InvalidPathException e) {
            throw new UnsafeArchiveException("Archive contains invalid path");
        }
    }

    private void countEntry(ExtractionCounter counter) {
        counter.entries++;
        if (counter.entries > properties.maxEntries()) {
            throw new ArchiveLimitException("Archive exceeds max entry count");
        }
    }

    private void writeRegularFile(InputStream input, Path target,
                                  ExtractionCounter counter) throws IOException {
        Path parent = target.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        long fileBytes = 0;
        byte[] buffer = new byte[BUFFER_SIZE];
        try (OutputStream output = Files.newOutputStream(
                target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                fileBytes += read;
                counter.totalBytes += read;
                if (fileBytes > properties.maxSingleFileBytes()) {
                    throw new ArchiveLimitException("Archive entry exceeds max single-file size");
                }
                if (counter.totalBytes > properties.maxExtractedBytes()) {
                    throw new ArchiveLimitException("Archive exceeds max extracted size");
                }
                output.write(buffer, 0, read);
            }
        }
        counter.files++;
    }

    private Path selectProjectRoot(Path destination) throws IOException {
        try (Stream<Path> children = Files.list(destination)) {
            List<Path> roots = children.toList();
            if (roots.size() == 1 && Files.isDirectory(roots.getFirst())) {
                return roots.getFirst();
            }
            return destination;
        }
    }

    private void cleanupAfterFailure(Path destination, Throwable cause) {
        try {
            ManagedFileTree.deleteIfExists(destination);
        } catch (RuntimeException cleanupFailure) {
            cause.addSuppressed(cleanupFailure);
        }
    }

    private enum ArchiveType {
        ZIP("ZIP"),
        TAR_GZ("TAR_GZ");

        private final String externalName;

        ArchiveType(String externalName) {
            this.externalName = externalName;
        }
    }

    private static final class ExtractionCounter {
        private int entries;
        private int files;
        private long totalBytes;
    }
}
