package com.repograph.core.util;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link PathUtil} 单元测试，验证相对路径转换的正确性。
 *
 * @author leolu
 * @since 0.1.0
 */
class PathUtilTest {

    @TempDir
    Path tempDir;

    @Test
    void toRelativePath_directChild_returnsFileName() throws IOException {
        Path file = Files.createTempFile(tempDir, "Foo", ".java");

        String result = PathUtil.toRelativePath(tempDir, file);

        assertThat(result).isEqualTo(file.getFileName().toString());
        assertThat(result).doesNotContain("\\");
    }

    @Test
    void toRelativePath_nestedFile_returnsRelativePath() throws IOException {
        Path subDir = tempDir.resolve("src/main/java");
        Files.createDirectories(subDir);
        Path file = subDir.resolve("Foo.java");
        Files.createFile(file);

        String result = PathUtil.toRelativePath(tempDir, file);

        assertThat(result).isEqualTo("src/main/java/Foo.java");
        assertThat(result).doesNotContain("\\");
    }

    @Test
    void toRelativePath_usesForwardSlash() throws IOException {
        Path subDir = tempDir.resolve("a/b");
        Files.createDirectories(subDir);
        Path file = Files.createTempFile(subDir, "x", ".java");

        String result = PathUtil.toRelativePath(tempDir, file);

        assertThat(result).doesNotContain("\\");
    }

    @Test
    void toRelativePath_sameAsRoot_returnsEmpty() {
        String result = PathUtil.toRelativePath(tempDir, tempDir);

        assertThat(result).isEmpty();
    }
}
