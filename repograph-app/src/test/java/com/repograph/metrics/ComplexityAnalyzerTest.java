package com.repograph.metrics;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link ComplexityAnalyzer#compute(String)} 单元测试。
 *
 * <p>验证各类决策点的计数逻辑，以及边界输入处理。
 *
 * @author leolu
 * @since 0.6.0
 */
class ComplexityAnalyzerTest {

    // ── Baseline ──────────────────────────────────────────────────────────────

    @Test
    void empty_source_returns_one() {
        assertThat(ComplexityAnalyzer.compute("")).isEqualTo(1);
    }

    @Test
    void null_source_returns_one() {
        assertThat(ComplexityAnalyzer.compute(null)).isEqualTo(1);
    }

    @Test
    void blank_source_returns_one() {
        assertThat(ComplexityAnalyzer.compute("   \n  ")).isEqualTo(1);
    }

    @Test
    void simple_method_no_branches_is_one() {
        assertThat(ComplexityAnalyzer.compute("""
                public String hello() {
                    return "Hello, World!";
                }
                """)).isEqualTo(1);
    }

    // ── if / else if ──────────────────────────────────────────────────────────

    @Test
    void single_if_adds_one() {
        assertThat(ComplexityAnalyzer.compute("""
                void check(int x) {
                    if (x > 0) doSomething();
                }
                """)).isEqualTo(2);
    }

    @Test
    void if_with_space_before_paren() {
        // Covers "if (" branch in counter
        assertThat(ComplexityAnalyzer.compute("if (x) {}")).isEqualTo(2);
    }

    @Test
    void else_if_counted_separately() {
        // "if (" matches twice: once in "if (score>=90)" and once inside "else if (score>=80)"
        // "else if" adds another +1 — heuristic intentionally double-counts for simplicity
        // base 1 + if( 2 + else if 1 = 4
        int cc = ComplexityAnalyzer.compute("""
                void grade(int score) {
                    if (score >= 90) {
                        grade = 'A';
                    } else if (score >= 80) {
                        grade = 'B';
                    }
                }
                """);
        assertThat(cc).isEqualTo(4);
    }

    // ── for / while / do ─────────────────────────────────────────────────────

    @Test
    void for_loop_adds_one() {
        assertThat(ComplexityAnalyzer.compute("for (int i=0; i<n; i++) {}")).isEqualTo(2);
    }

    @Test
    void while_loop_adds_one() {
        assertThat(ComplexityAnalyzer.compute("while (running) { process(); }")).isEqualTo(2);
    }

    @Test
    void do_while_counts_both_do_and_while() {
        // do...while contributes 2: "do {" → +1, "while (" → +1
        assertThat(ComplexityAnalyzer.compute("do { read(); } while (hasMore);")).isEqualTo(3);
    }

    // ── switch / catch ───────────────────────────────────────────────────────

    @Test
    void two_case_labels_add_two() {
        int cc = ComplexityAnalyzer.compute("""
                switch (day) {
                    case MONDAY:
                        doWork();
                        break;
                    case FRIDAY:
                        celebrate();
                        break;
                    default:
                        rest();
                }
                """);
        // base 1 + 2 cases
        assertThat(cc).isEqualTo(3);
    }

    @Test
    void catch_block_adds_one() {
        int cc = ComplexityAnalyzer.compute("""
                try {
                    riskyOp();
                } catch (IOException e) {
                    handle(e);
                }
                """);
        assertThat(cc).isEqualTo(2);
    }

    @Test
    void multiple_catch_blocks_each_add_one() {
        int cc = ComplexityAnalyzer.compute("""
                try {
                    op();
                } catch (IOException e) {
                    handleIo(e);
                } catch (RuntimeException e) {
                    handleRuntime(e);
                }
                """);
        assertThat(cc).isEqualTo(3);
    }

    // ── Logical operators ────────────────────────────────────────────────────

    @Test
    void logical_and_adds_one() {
        assertThat(ComplexityAnalyzer.compute("if (a && b) {}")).isEqualTo(3); // if + &&
    }

    @Test
    void logical_or_adds_one() {
        assertThat(ComplexityAnalyzer.compute("if (x || y) {}")).isEqualTo(3); // if + ||
    }

    @Test
    void ternary_adds_one() {
        assertThat(ComplexityAnalyzer.compute("String s = flag ? \"yes\" : \"no\";")).isEqualTo(2);
    }

    // ── Compound case ────────────────────────────────────────────────────────

    @Test
    void complex_method_known_cc() {
        // if(1) + else if(1) + for(1) + && (1) + catch(1) = 5 + base 1 = CC 6
        int cc = ComplexityAnalyzer.compute("""
                void process(List<String> items) {
                    if (items == null) return;
                    else if (items.isEmpty()) return;
                    for (String item : items) {
                        if (item != null && !item.isBlank()) {
                            try {
                                handle(item);
                            } catch (Exception e) {
                                log(e);
                            }
                        }
                    }
                }
                """);
        // base=1, if( matches 3x (direct if + 1 more inside else if + inner if), else if=1, for(=1, &&=1, catch(=1 → 8
        assertThat(cc).isEqualTo(8);
    }

    // ── Case-insensitive matching ─────────────────────────────────────────────

    @Test
    void matching_is_case_insensitive() {
        // Python-style uppercase IF won't appear in real code but tests lowercasing
        assertThat(ComplexityAnalyzer.compute("IF (x > 0) doIt();")).isEqualTo(2);
    }
}
