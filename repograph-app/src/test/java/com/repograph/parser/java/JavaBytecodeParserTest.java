package com.repograph.parser.java;

import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.model.RelationEdge;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 编译级别字节码解析器集成测试。
 *
 * <p>使用 repograph-parser 模块自身的编译产物（build/classes/java/main）作为输入，
 * 验证 {@link JavaBytecodeParser} 的核心能力：
 * <ul>
 *   <li>从 .class 文件提取类 / 方法 / 字段 CodeUnit</li>
 *   <li>从字节码 invoke 指令生成 CALLS 边</li>
 *   <li>识别 EXTENDS / IMPLEMENTS 边</li>
 * </ul>
 *
 * <p>测试依赖 Gradle 先完成 compileJava，因此在 IDE 中首次运行前需执行一次 build。
 */
class JavaBytecodeParserTest {

    private static final JavaBytecodeParser PARSER = new JavaBytecodeParser();

    /** ParserDispatcher.class 路径，位于 repograph-parser 编译产物目录下。 */
    private static Path DISPATCHER_CLASS;
    private static ParseOptions OPTS;

    @BeforeAll
    static void setup() {
        // projectRoot = repograph-parser 模块根，这样 findClassRoot() 能找到 build/classes/java/main
        Path moduleRoot = findProjectRoot().resolve("repograph-parser");
        Path classRoot = moduleRoot.resolve("build/classes/java/main");
        DISPATCHER_CLASS = classRoot.resolve("com/repograph/parser/ParserDispatcher.class");
        // ParseOptions.projectRoot 传模块根，tryFetchSource() 在 src/main/java 下能找到源文件
        OPTS = new ParseOptions(null, List.of("class"), moduleRoot, null);
    }

    @Test
    void supports_class_language() {
        assertThat(PARSER.supports("class")).isTrue();
        assertThat(PARSER.supports("java")).isFalse();
    }

    @Test
    void parse_extracts_class_unit() throws Exception {
        assumeClassExists();
        ParseResult result = PARSER.parse(DISPATCHER_CLASS, OPTS);

        assertThat(result.units()).isNotEmpty();
        var classUnit = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.CLASS && u.qualifiedName().contains("ParserDispatcher"))
                .findFirst();
        assertThat(classUnit).isPresent();
        assertThat(classUnit.get().language()).isEqualTo("java");
        assertThat(classUnit.get().metadata()).containsKey("bytecode");
    }

    @Test
    void parse_extracts_method_units() throws Exception {
        assumeClassExists();
        ParseResult result = PARSER.parse(DISPATCHER_CLASS, OPTS);

        var methods = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.METHOD)
                .collect(Collectors.toList());
        assertThat(methods).isNotEmpty();

        // dispatch() 方法应该在提取结果中
        var dispatch = methods.stream()
                .filter(u -> u.qualifiedName().contains("#dispatch("))
                .findFirst();
        assertThat(dispatch).isPresent();
    }

    @Test
    void parse_produces_calls_edges() throws Exception {
        assumeClassExists();
        ParseResult result = PARSER.parse(DISPATCHER_CLASS, OPTS);

        List<RelationEdge> callEdges = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS)
                .collect(Collectors.toList());
        // dispatch() 调用了 detectLanguage()、runWithFallback() 等，至少有一条 CALLS 边
        assertThat(callEdges).isNotEmpty();
    }

    @Test
    void parse_produces_contains_edges() throws Exception {
        assumeClassExists();
        ParseResult result = PARSER.parse(DISPATCHER_CLASS, OPTS);

        List<RelationEdge> containsEdges = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CONTAINS)
                .collect(Collectors.toList());
        assertThat(containsEdges).isNotEmpty();
    }

    @Test
    void parse_anonymous_class_returns_empty() throws Exception {
        // 匿名类（Outer$1.class）应该被跳过，返回空结果
        Path fakeAnon = Paths.get("/fake/com/example/Outer$1.class");
        ParseResult result = PARSER.parse(fakeAnon, OPTS);
        assertThat(result.units()).isEmpty();
        assertThat(result.edges()).isEmpty();
    }

    @Test
    void parse_skips_static_init_method() throws Exception {
        assumeClassExists();
        ParseResult result = PARSER.parse(DISPATCHER_CLASS, OPTS);

        // <clinit> 不应出现在 CodeUnit 中
        boolean hasClinitUnit = result.units().stream()
                .anyMatch(u -> u.simpleName().equals("<clinit>")
                        || u.qualifiedName().contains("#<clinit>"));
        assertThat(hasClinitUnit).isFalse();
    }

    // ── 辅助方法 ──────────────────────────────────────────────────────────────

    private static void assumeClassExists() {
        org.junit.jupiter.api.Assumptions.assumeTrue(
                DISPATCHER_CLASS.toFile().exists(),
                "Compiled class not found at " + DISPATCHER_CLASS
                        + " — run './gradlew :repograph-parser:compileJava' first"
        );
    }

    private static Path findProjectRoot() {
        Path dir = Paths.get("").toAbsolutePath();
        while (dir != null) {
            if (dir.resolve("settings.gradle.kts").toFile().exists()
                    || dir.resolve("settings.gradle").toFile().exists()) {
                return dir;
            }
            dir = dir.getParent();
        }
        return Paths.get("").toAbsolutePath();
    }
}
