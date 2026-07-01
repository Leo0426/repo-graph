package com.repograph.vuln;

/**
 * 轻量 Maven 版本比较器，支持 {@code major.minor.patch[-qualifier]} 格式。
 *
 * <p>比较规则：
 * <ul>
 *   <li>按 {@code .} 分段后逐段数字比较，段少的版本补 0</li>
 *   <li>带 qualifier（{@code -alpha}、{@code -beta}、{@code -SNAPSHOT} 等）的版本视为低于同数字的 release</li>
 *   <li>空字符串版本视为最小版本 0.0.0</li>
 * </ul>
 *
 * <p>精度：处理 4 段版本（如 {@code 2.9.10.5}）和 qualifier 前缀数字（{@code 2.0-beta9} → {@code 2.0.-1}）。
 *
 * @author leolu
 * @since 0.5.0
 */
final class SemanticVersion implements Comparable<SemanticVersion> {

    private final int[] parts;
    private final boolean hasQualifier;

    static SemanticVersion of(String version) {
        if (version == null || version.isBlank()) return new SemanticVersion(new int[0], false);
        // 分离限定符："2.0-beta9" → 数值部分 "2.0"，限定符存在
        String[] qSplit = version.split("-", 2);
        boolean hasQualifier = qSplit.length > 1;
        String[] segments = qSplit[0].split("\\.");
        int[] parts = new int[segments.length];
        for (int i = 0; i < segments.length; i++) {
            try {
                parts[i] = Integer.parseInt(segments[i]);
            } catch (NumberFormatException e) {
                parts[i] = 0;
            }
        }
        return new SemanticVersion(parts, hasQualifier);
    }

    private SemanticVersion(int[] parts, boolean hasQualifier) {
        this.parts = parts;
        this.hasQualifier = hasQualifier;
    }

    @Override
    public int compareTo(SemanticVersion other) {
        int maxLen = Math.max(this.parts.length, other.parts.length);
        for (int i = 0; i < maxLen; i++) {
            int a = i < this.parts.length ? this.parts[i] : 0;
            int b = i < other.parts.length ? other.parts[i] : 0;
            if (a != b) return Integer.compare(a, b);
        }
        // 数值部分相等时：带限定符版本 < 正式版本
        if (this.hasQualifier && !other.hasQualifier) return -1;
        if (!this.hasQualifier && other.hasQualifier) return 1;
        return 0;
    }

    boolean isLessThan(SemanticVersion other)            { return compareTo(other) < 0; }
    boolean isGreaterThanOrEqual(SemanticVersion other)  { return compareTo(other) >= 0; }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.length; i++) {
            if (i > 0) sb.append('.');
            sb.append(parts[i]);
        }
        if (hasQualifier) sb.append("-qualifier");
        return sb.toString();
    }
}
