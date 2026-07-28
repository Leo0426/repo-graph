package com.repograph.core.scanner;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 一批外部扫描的执行选项。
 *
 * @param scanners       要运行的扫描器标识
 * @param languages      资产画像识别出的语言
 * @param timeoutSeconds 每个扫描器的最大执行秒数
 * @author leolu
 */
public record ExternalScanOptions(
        Set<String> scanners,
        List<String> languages,
        long timeoutSeconds
) {
    /**
     * 规范化扫描器和语言名称。
     */
    public ExternalScanOptions {
        scanners = scanners == null ? Set.of() : scanners.stream()
                .filter(value -> value != null && !value.isBlank())
                .map(value -> value.trim().toUpperCase(Locale.ROOT))
                .collect(Collectors.toUnmodifiableSet());
        languages = languages == null ? List.of() : languages.stream()
                .filter(value -> value != null && !value.isBlank())
                .map(value -> value.trim().toLowerCase(Locale.ROOT))
                .distinct()
                .toList();
        if (scanners.isEmpty()) {
            throw new IllegalArgumentException("at least one scanner is required");
        }
        if (timeoutSeconds < 1) {
            throw new IllegalArgumentException("timeoutSeconds must be greater than zero");
        }
    }
}
