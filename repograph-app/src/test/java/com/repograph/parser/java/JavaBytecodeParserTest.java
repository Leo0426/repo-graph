package com.repograph.parser.java;

import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.model.RelationEdge;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.tools.ToolProvider;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 编译级别字节码解析器集成测试。
 *
 * <p>在独立临时目录编译最小 Java fixture，
 * 验证 {@link JavaBytecodeParser} 的核心能力：
 * <ul>
 *   <li>从 .class 文件提取类 / 方法 / 字段 CodeUnit</li>
 *   <li>从字节码 invoke 指令生成 CALLS 边</li>
 *   <li>识别 EXTENDS / IMPLEMENTS 边</li>
 * </ul>
 *
 * <p>使用运行测试的 JDK 编译器，不依赖仓库模块布局或已有构建产物，缺少 fixture 时直接失败。
 *
 * @author leolu
 */
class JavaBytecodeParserTest {

    private final JavaBytecodeParser parser = new JavaBytecodeParser();

    @TempDir
    Path moduleRoot;

    private Path fixtureClass;
    private ParseOptions options;

    @BeforeEach
    void setup() throws Exception {
        Path classRoot = moduleRoot.resolve("build/classes/java/main");
        Path source = moduleRoot.resolve("src/main/java/fixture/Sample.java");
        Files.createDirectories(classRoot);
        Files.createDirectories(source.getParent());
        Files.writeString(source, """
                package fixture;
                interface Contract { void dispatch(); }
                class Base {}
                public class Sample extends Base implements Contract {
                    private int value;
                    static { System.getProperty("java.version"); }
                    public void dispatch() { target(); }
                    private void target() { value++; }
                    public static class Nested { public void run() {} }
                }
                """);
        var compiler = ToolProvider.getSystemJavaCompiler();
        assertThat(compiler).as("Tests require a JDK compiler").isNotNull();
        assertThat(compiler.run(null, null, null, "-g", "-d", classRoot.toString(), source.toString()))
                .isZero();
        fixtureClass = classRoot.resolve("fixture/Sample.class");
        assertThat(fixtureClass).isRegularFile();
        options = new ParseOptions(null, List.of("class"), moduleRoot, null);
    }

    @Test
    void supports_class_language() {
        assertThat(parser.supports("class")).isTrue();
        assertThat(parser.supports("java")).isFalse();
    }

    @Test
    void parse_extracts_class_unit() throws Exception {
        ParseResult result = parser.parse(fixtureClass, options);

        assertThat(result.units()).isNotEmpty();
        var classUnit = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.CLASS && u.qualifiedName().equals("fixture.Sample"))
                .findFirst();
        assertThat(classUnit).isPresent();
        assertThat(classUnit.get().language()).isEqualTo("java");
        assertThat(classUnit.get().metadata()).containsKey("bytecode");
    }

    @Test
    void parse_extracts_method_units() throws Exception {
        ParseResult result = parser.parse(fixtureClass, options);

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
        ParseResult result = parser.parse(fixtureClass, options);

        List<RelationEdge> callEdges = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS)
                .collect(Collectors.toList());
        assertThat(callEdges).anyMatch(edge -> edge.targetId().equals("fixture.Sample#target()"));
    }

    @Test
    void parse_produces_contains_edges() throws Exception {
        ParseResult result = parser.parse(fixtureClass, options);

        List<RelationEdge> containsEdges = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CONTAINS)
                .collect(Collectors.toList());
        assertThat(containsEdges).isNotEmpty();
    }

    @Test
    void parse_anonymous_class_returns_empty() throws Exception {
        // 匿名类（Outer$1.class）应该被跳过，返回空结果
        Path fakeAnon = Paths.get("/fake/com/example/Outer$1.class");
        ParseResult result = parser.parse(fakeAnon, options);
        assertThat(result.units()).isEmpty();
        assertThat(result.edges()).isEmpty();
    }

    @Test
    void parse_skips_static_init_method() throws Exception {
        ParseResult result = parser.parse(fixtureClass, options);

        // <clinit> 不应出现在 CodeUnit 中
        boolean hasClinitUnit = result.units().stream()
                .anyMatch(u -> u.simpleName().equals("<clinit>")
                        || u.qualifiedName().contains("#<clinit>"));
        assertThat(hasClinitUnit).isFalse();
    }

    @Test
    void parse_keeps_extends_and_implements_separate() throws Exception {
        ParseResult result = parser.parse(fixtureClass, options);
        assertThat(result.edges()).anyMatch(edge -> edge.kind() == EdgeKind.EXTENDS
                && edge.targetId().equals("fixture.Base"));
        assertThat(result.edges()).anyMatch(edge -> edge.kind() == EdgeKind.IMPLEMENTS
                && edge.targetId().equals("fixture.Contract"));
    }

    @Test
    void parse_preserves_nested_class_name() throws Exception {
        ParseResult result = parser.parse(fixtureClass.resolveSibling("Sample$Nested.class"), options);
        assertThat(result.units()).anyMatch(unit -> unit.kind() == CodeUnitKind.CLASS
                && unit.qualifiedName().equals("fixture.Sample$Nested"));
    }
}
