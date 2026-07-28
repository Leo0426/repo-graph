package com.repograph.scanner;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;

/**
 * 受控扫描工作目录清理工具。
 */
final class ScannerWorkTree {

    private ScannerWorkTree() {}

    static void deleteBatch(Path configuredRoot, String batchId) {
        if (batchId == null || !batchId.matches("[A-Za-z0-9_-]+")) {
            throw new IllegalStateException("Refusing to delete invalid scanner batch identifier");
        }
        Path root = configuredRoot.toAbsolutePath().normalize();
        Path batchRoot = root.resolve(batchId).normalize();
        if (!batchRoot.getParent().equals(root)) {
            throw new IllegalStateException("Refusing to delete scanner path outside controlled root");
        }
        if (!Files.exists(batchRoot)) {
            return;
        }
        try (var paths = Files.walk(batchRoot)) {
            paths.sorted(Comparator.reverseOrder()).forEach(ScannerWorkTree::delete);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to enumerate scanner work directory", e);
        }
    }

    private static void delete(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to delete scanner work path: " + path, e);
        }
    }
}
