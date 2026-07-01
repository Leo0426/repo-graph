package com.repograph.app.pipeline;

import com.repograph.core.parser.ParseStrategy;
import com.repograph.core.pipeline.IndexOptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests source file discovery and language filtering.
 *
 * @author leolu
 * @since 0.1.0
 */
class SourceFileScannerTest {

    @TempDir
    Path projectRoot;

    private final SourceFileScanner scanner = new SourceFileScanner();

    @Test
    void scan_withoutLanguageFilter_includesSupportedLanguages() throws Exception {
        Path javaFile = Files.createTempFile(projectRoot, "Foo", ".java");
        Path cFile = Files.createTempFile(projectRoot, "main", ".c");
        Path headerFile = Files.createTempFile(projectRoot, "types", ".h");
        Path pythonFile = Files.createTempFile(projectRoot, "script", ".py");
        Files.createTempFile(projectRoot, "notes", ".md");

        List<Path> files = scanner.scan(projectRoot, IndexOptions.defaults());

        assertThat(files).containsExactlyInAnyOrder(javaFile, cFile, headerFile, pythonFile);
    }

    @Test
    void scan_withLanguageFilter_includesOnlyMatchingExtensions() throws Exception {
        Path javaFile = Files.createTempFile(projectRoot, "Foo", ".java");
        Files.createTempFile(projectRoot, "script", ".py");

        IndexOptions options = new IndexOptions(List.of("java"), ParseStrategy.AUTO, true, null);

        assertThat(scanner.scan(projectRoot, options)).containsExactly(javaFile);
    }
}
