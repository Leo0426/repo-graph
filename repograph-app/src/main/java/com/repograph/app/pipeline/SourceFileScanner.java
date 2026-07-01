package com.repograph.app.pipeline;

import com.repograph.core.pipeline.IndexOptions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Scans project roots for supported source files and applies language filters.
 *
 * @author leolu
 * @since 0.1.0
 */
@Component
class SourceFileScanner {

    private static final Logger log = LoggerFactory.getLogger(SourceFileScanner.class);

    /** 源码扩展名映射，默认扫描。 */
    private static final Map<String, String> EXTENSION_TO_LANGUAGE = Map.of(
            "java", "java",
            "c", "c",
            "h", "c",
            "py", "python"
    );

    /**
     * 字节码扩展名映射。仅当 IndexOptions.languages 中显式包含 {@code "class"} 时才启用，
     * 避免默认流程扫描到 build/ 目录下的 .class 文件，与源码解析产生重复 CodeUnit。
     */
    private static final Map<String, String> BYTECODE_EXTENSIONS = Map.of(
            "class", "class"
    );

    // 构建产物、IDE 元数据、依赖缓存等不应被索引的顶层目录名
    private static final Set<String> EXCLUDED_DIRS = Set.of(
            "build", "target", "out", ".gradle", ".git", ".idea",
            "node_modules", "__pycache__", ".tox", ".venv", "venv",
            ".mvn", ".cache"
    );

    List<Path> scan(Path projectRoot, IndexOptions options) {
        Set<String> targetExtensions = targetExtensions(options);
        try (Stream<Path> walk = Files.walk(projectRoot)) {
            return walk
                    .filter(path -> !isExcluded(path, projectRoot))
                    .filter(Files::isRegularFile)
                    .filter(path -> targetExtensions.contains(extensionOf(path)))
                    .collect(Collectors.toList());
        } catch (IOException e) {
            log.error("Failed to scan files in {}: {}", projectRoot, e.getMessage());
            return List.of();
        }
    }

    /** 路径中任一段名称命中黑名单时跳过（对目录和文件均生效）。 */
    private static boolean isExcluded(Path path, Path projectRoot) {
        Path relative = projectRoot.relativize(path);
        for (Path segment : relative) {
            if (EXCLUDED_DIRS.contains(segment.toString())) return true;
        }
        return false;
    }

    private static Set<String> targetExtensions(IndexOptions options) {
        List<String> langs = options.languages();
        boolean explicitBytecode = langs != null && langs.contains("class");

        if (langs == null || langs.isEmpty()) {
            // 默认模式：只扫源码，不扫字节码，防止 build/ 目录产生重复索引
            return EXTENSION_TO_LANGUAGE.keySet();
        }

        Set<String> extensions = langs.stream()
                .flatMap(lang -> EXTENSION_TO_LANGUAGE.entrySet().stream()
                        .filter(e -> e.getValue().equals(lang))
                        .map(Map.Entry::getKey))
                .collect(Collectors.toCollection(java.util.HashSet::new));

        if (explicitBytecode) {
            extensions.addAll(BYTECODE_EXTENSIONS.keySet());
        }
        return extensions;
    }

    private static String extensionOf(Path path) {
        String name = path.getFileName().toString();
        int dot = name.lastIndexOf('.');
        if (dot < 0) {
            return "";
        }
        return name.substring(dot + 1).toLowerCase();
    }
}
