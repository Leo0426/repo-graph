package com.repograph.vuln;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link SemanticVersion} 版本比较逻辑测试。
 *
 * <p>覆盖：正常版本大小比较、qualifier 排序、多段版本、空版本、边界值。
 *
 * @author leolu
 * @since 0.5.0
 */
class SemanticVersionTest {

    // ── 基本大小比较 ──────────────────────────────────────────────────────────

    @Test
    void patch_increment_is_greater() {
        assertLess("2.15.0", "2.15.1");
    }

    @Test
    void minor_increment_is_greater() {
        assertLess("2.14.9", "2.15.0");
    }

    @Test
    void major_increment_is_greater() {
        assertLess("1.99.99", "2.0.0");
    }

    @Test
    void equal_versions_are_not_less() {
        SemanticVersion a = SemanticVersion.of("2.15.0");
        SemanticVersion b = SemanticVersion.of("2.15.0");
        assertThat(a.isLessThan(b)).isFalse();
        assertThat(a.isGreaterThanOrEqual(b)).isTrue();
    }

    // ── Qualifier 排序 ────────────────────────────────────────────────────────

    @Test
    void qualifier_is_less_than_release() {
        // 2.0-beta9 < 2.0
        assertLess("2.0-beta9", "2.0");
    }

    @Test
    void qualifier_is_less_than_patch() {
        // 2.0.0-alpha1 < 2.0.0
        assertLess("2.0.0-alpha1", "2.0.0");
    }

    @Test
    void release_is_not_less_than_qualifier() {
        SemanticVersion rel = SemanticVersion.of("2.15.0");
        SemanticVersion q   = SemanticVersion.of("2.15.0-SNAPSHOT");
        assertThat(rel.isLessThan(q)).isFalse();
        assertThat(rel.isGreaterThanOrEqual(q)).isTrue();
    }

    // ── 多段版本（4 段） ──────────────────────────────────────────────────────

    @Test
    void four_part_version_comparison() {
        // log4j 受影响版本: 2.0-beta9 .. 2.15.0
        // 2.9.10.5 应小于 2.15.0
        assertLess("2.9.10.5", "2.15.0");
    }

    @Test
    void four_part_greater_than_three_part() {
        // 2.9.10.6 vs 2.9.10 — 2.9.10.6 > 2.9.10 (补零后 2.9.10.6 > 2.9.10.0)
        assertLess("2.9.10", "2.9.10.6");
    }

    // ── 边界值 ────────────────────────────────────────────────────────────────

    @Test
    void empty_version_is_minimum() {
        // empty < any real version
        assertLess("", "1.0.0");
    }

    @Test
    void null_version_is_minimum() {
        assertLess(null, "1.0.0");
    }

    @Test
    void same_major_different_minor() {
        assertLess("5.3.0", "5.3.18");
    }

    // ── Advisory 命中场景验证 ─────────────────────────────────────────────────

    @Test
    void log4shell_affected_range() {
        // CVE-2021-44228: introduced=2.0-beta9, fixed=2.15.0
        // Version 2.14.1 should be affected
        SemanticVersion introduced = SemanticVersion.of("2.0-beta9");
        SemanticVersion fixed      = SemanticVersion.of("2.15.0");
        SemanticVersion victim     = SemanticVersion.of("2.14.1");

        assertThat(victim.isGreaterThanOrEqual(introduced)).isTrue();
        assertThat(victim.isLessThan(fixed)).isTrue();
    }

    @Test
    void log4shell_fixed_version_not_affected() {
        SemanticVersion introduced = SemanticVersion.of("2.0-beta9");
        SemanticVersion fixed      = SemanticVersion.of("2.15.0");
        SemanticVersion safe       = SemanticVersion.of("2.17.0");

        assertThat(safe.isGreaterThanOrEqual(introduced)).isTrue();
        assertThat(safe.isLessThan(fixed)).isFalse(); // NOT affected
    }

    @Test
    void spring4shell_affected_range() {
        // CVE-2022-22965: introduced=5.3.0, fixed=5.3.18
        SemanticVersion introduced = SemanticVersion.of("5.3.0");
        SemanticVersion fixed      = SemanticVersion.of("5.3.18");
        SemanticVersion victim     = SemanticVersion.of("5.3.15");

        assertThat(victim.isGreaterThanOrEqual(introduced)).isTrue();
        assertThat(victim.isLessThan(fixed)).isTrue();
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    private static void assertLess(String lower, String higher) {
        SemanticVersion lo = SemanticVersion.of(lower);
        SemanticVersion hi = SemanticVersion.of(higher);
        assertThat(lo.isLessThan(hi))
                .as("%s should be less than %s", lower, higher)
                .isTrue();
        assertThat(hi.isGreaterThanOrEqual(lo))
                .as("%s should be >= %s", higher, lower)
                .isTrue();
    }
}
