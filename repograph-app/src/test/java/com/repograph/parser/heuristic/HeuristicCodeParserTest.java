package com.repograph.parser.heuristic;

import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import com.repograph.core.parser.ParseStrategy;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link HeuristicCodeParser} 单元测试，验证基于状态机的降级解析逻辑。
 *
 * @author leolu
 * @since 0.1.0
 */
class HeuristicCodeParserTest {

    @TempDir
    Path tempDir;

    private HeuristicCodeParser parser;

    @BeforeEach
    void setUp() {
        parser = new HeuristicCodeParser();
    }

    // ── Language support ──────────────────────────────────────────────────────

    @Test
    void supports_java_returnsTrue() {
        assertThat(parser.supports("java")).isTrue();
    }

    @Test
    void supports_c_returnsTrue() {
        assertThat(parser.supports("c")).isTrue();
    }

    @Test
    void supports_python_returnsTrue() {
        assertThat(parser.supports("python")).isTrue();
    }

    @Test
    void supports_unknown_returnsFalse() {
        assertThat(parser.supports("rust")).isFalse();
    }

    // ── Java parsing ──────────────────────────────────────────────────────────

    @Test
    void parse_javaClass_extractsClass() throws Exception {
        Path file = javaFile("SimpleClass.java",
                "public class SimpleClass {\n" +
                "}\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).anyMatch(u -> u.kind() == CodeUnitKind.CLASS
                && u.simpleName().equals("SimpleClass"));
    }

    @Test
    void parse_javaMethod_extractsMethod() throws Exception {
        Path file = javaFile("Foo.java",
                "public class Foo {\n" +
                "    public void doWork() {\n" +
                "        int x = 1;\n" +
                "    }\n" +
                "}\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).anyMatch(u -> u.kind() == CodeUnitKind.METHOD
                && u.simpleName().equals("doWork"));
    }

    @Test
    void parse_emptyJavaFile_returnsEmpty() throws Exception {
        Path file = javaFile("Empty.java", "");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).isEmpty();
        assertThat(result.edges()).isEmpty();
    }

    @Test
    void parse_java_noEdgesProduced() throws Exception {
        Path file = javaFile("Foo.java",
                "public class Foo {\n" +
                "    public void bar() {}\n" +
                "}\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.edges()).isEmpty();
    }

    @Test
    void parse_java_heuristicMetadataSet() throws Exception {
        Path file = javaFile("Foo.java",
                "public class Foo {\n" +
                "}\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).allMatch(u -> "true".equals(u.metadata().get("heuristic")));
    }

    @Test
    void parse_javaInterface_extractedAsClassKind() throws Exception {
        // Heuristic parser maps class/interface/enum/record all to CLASS (simplified fallback)
        Path file = javaFile("IFoo.java",
                "public interface IFoo {\n" +
                "    void doFoo();\n" +
                "}\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).anyMatch(u -> u.kind() == CodeUnitKind.CLASS
                && u.simpleName().equals("IFoo"));
    }

    @Test
    void parse_javaEnum_extractedAsClassKind() throws Exception {
        // Heuristic parser maps enum keyword → CLASS (simplified fallback)
        Path file = javaFile("Status.java",
                "public enum Status {\n" +
                "    ACTIVE, INACTIVE;\n" +
                "}\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).anyMatch(u -> u.kind() == CodeUnitKind.CLASS
                && u.simpleName().equals("Status"));
    }

    @Test
    void parse_javaRecord_extractedAsClassKind() throws Exception {
        // Heuristic parser maps record keyword → CLASS (simplified fallback)
        Path file = javaFile("Point.java",
                "public record Point(int x, int y) {\n" +
                "}\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).anyMatch(u -> u.kind() == CodeUnitKind.CLASS
                && u.simpleName().equals("Point"));
    }

    @Test
    void parse_java_multipleClasses_extractsAll() throws Exception {
        Path file = javaFile("Multi.java",
                "public class Alpha {\n" +
                "}\n" +
                "class Beta {\n" +
                "}\n");

        ParseResult result = parser.parse(file, opts());

        long classCount = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.CLASS).count();
        assertThat(classCount).isGreaterThanOrEqualTo(2);
    }

    // ── C parsing ─────────────────────────────────────────────────────────────

    @Test
    void parse_cFunction_extractsFunction() throws Exception {
        Path file = cFile("foo.c",
                "int add(int a, int b) {\n" +
                "    return a + b;\n" +
                "}\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).anyMatch(u -> u.kind() == CodeUnitKind.FUNCTION
                && u.simpleName().equals("add"));
    }

    @Test
    void parse_cStruct_extractsStruct() throws Exception {
        Path file = cFile("point.c",
                "struct Point {\n" +
                "    int x;\n" +
                "    int y;\n" +
                "};\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).anyMatch(u -> u.kind() == CodeUnitKind.STRUCT
                && u.simpleName().equals("Point"));
    }

    // ── Python parsing ────────────────────────────────────────────────────────

    @Test
    void parse_pythonClass_extractsClass() throws Exception {
        // A top-level sentinel after the class body triggers the state machine's COMPLETE transition.
        Path file = pyFile("foo.py",
                "class MyClass:\n" +
                "    pass\n" +
                "\n" +
                "x = 0\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).anyMatch(u -> u.kind() == CodeUnitKind.CLASS
                && u.simpleName().equals("MyClass"));
    }

    @Test
    void parse_pythonFunction_extractsMethod() throws Exception {
        Path file = pyFile("foo.py",
                "def greet(name):\n" +
                "    return 'Hello ' + name\n" +
                "\n" +
                "def other():\n" +
                "    pass\n" +
                "\n" +
                "x = 0\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).anyMatch(u -> u.kind() == CodeUnitKind.METHOD
                && u.simpleName().equals("greet"));
    }

    @Test
    void parse_pythonAsyncDef_extractsMethod() throws Exception {
        Path file = pyFile("foo.py",
                "async def fetch(url):\n" +
                "    pass\n" +
                "\n" +
                "x = 0\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).anyMatch(u -> u.kind() == CodeUnitKind.METHOD
                && u.simpleName().equals("fetch"));
    }

    @Test
    void parse_cFile_noEdgesProduced() throws Exception {
        Path file = cFile("hello.c",
                "void greet(void) {\n" +
                "    return;\n" +
                "}\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.edges()).isEmpty();
    }

    // ── Unsupported extension ─────────────────────────────────────────────────

    @Test
    void parse_unsupportedExtension_returnsEmpty() throws Exception {
        Path file = Files.createTempFile(tempDir, "data", ".csv");
        Files.writeString(file, "a,b,c\n1,2,3\n");

        ParseResult result = parser.parse(file, opts());

        assertThat(result.units()).isEmpty();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Path javaFile(String name, String content) throws IOException {
        Path file = tempDir.resolve(name);
        Files.writeString(file, content);
        return file;
    }

    private Path cFile(String name, String content) throws IOException {
        Path file = tempDir.resolve(name);
        Files.writeString(file, content);
        return file;
    }

    private Path pyFile(String name, String content) throws IOException {
        Path file = tempDir.resolve(name);
        Files.writeString(file, content);
        return file;
    }

    private ParseOptions opts() {
        return new ParseOptions(ParseStrategy.HEURISTIC, java.util.List.of(), tempDir);
    }
}
