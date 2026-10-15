package com.repograph.parser.treesitter;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.model.RelationEdge;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.groups.Tuple.tuple;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * {@link JavaScriptCodeParser} 单元测试。
 *
 * <p>所有测试在 {@code @BeforeEach} 中通过 {@code assumeTrue(parser.supports("javascript"))}
 * 检查 native 库是否可用；库不可用时测试跳过（而非失败）。
 *
 * @author leolu
 * @since 0.6.0
 */
class JavaScriptCodeParserTest {

    private JavaScriptCodeParser parser;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        parser = new JavaScriptCodeParser();
        assumeTrue(parser.supports("javascript"),
                "Tree-sitter JavaScript native library not available — skipping tests");
    }

    @Test
    void supports_typescript_returnsFalse() {
        assertThat(parser.supports("typescript")).isFalse();
    }

    @Test
    void parse_emptyFile_returnsEmpty() throws Exception {
        Path file = tempDir.resolve("empty.js");
        Files.writeString(file, "");
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));
        assertThat(result.units()).isEmpty();
        assertThat(result.edges()).isEmpty();
    }

    @Test
    void parse_functionAndCalls_resolvesInFileEdges() throws Exception {
        Path file = tempDir.resolve("app.js");
        Files.writeString(file, """
                function loadProfile(id) {
                    return query(id);
                }

                function fetchUser(id) {
                    return loadProfile(id);
                }
                """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units())
                .extracting(CodeUnit::kind, CodeUnit::simpleName)
                .containsExactlyInAnyOrder(
                        tuple(CodeUnitKind.FUNCTION, "loadProfile"),
                        tuple(CodeUnitKind.FUNCTION, "fetchUser"));

        // fetchUser → loadProfile 在文件内可解析；loadProfile → query 为未解析占位
        String loadProfileId = result.units().stream()
                .filter(u -> "loadProfile".equals(u.simpleName()))
                .findFirst().orElseThrow().id();
        String fetchUserId = result.units().stream()
                .filter(u -> "fetchUser".equals(u.simpleName()))
                .findFirst().orElseThrow().id();

        assertThat(result.edges()).extracting(RelationEdge::kind)
                .containsOnly(EdgeKind.CALLS);
        assertThat(result.edges()).anySatisfy(edge -> {
            assertThat(edge.resolved()).isTrue();
            assertThat(edge.sourceId()).isEqualTo(fetchUserId);
            assertThat(edge.targetId()).isEqualTo(loadProfileId);
        });
        assertThat(result.edges()).anySatisfy(edge -> assertThat(edge.resolved()).isFalse());
    }

    @Test
    void parse_classWithMethods_mapsMethodAndQualifiedName() throws Exception {
        Path file = tempDir.resolve("repo.js");
        Files.writeString(file, """
                class UserRepo {
                    find(id) {
                        return loadProfile(id);
                    }
                }
                """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units())
                .extracting(CodeUnit::kind, CodeUnit::qualifiedName)
                .contains(
                        tuple(CodeUnitKind.CLASS, "UserRepo"),
                        tuple(CodeUnitKind.METHOD, "UserRepo.find"));
    }

    @Test
    void parse_exportWrapper_stillExtractsDeclaration() throws Exception {
        Path file = tempDir.resolve("exported.js");
        Files.writeString(file, """
                export function bootstrap() {
                    return true;
                }

                export class App {}
                """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units())
                .extracting(CodeUnit::kind, CodeUnit::simpleName)
                .containsExactlyInAnyOrder(
                        tuple(CodeUnitKind.FUNCTION, "bootstrap"),
                        tuple(CodeUnitKind.CLASS, "App"));
    }

    @Test
    void parse_arrowFunctionConst_extractsFunction() throws Exception {
        Path file = tempDir.resolve("handler.mjs");
        Files.writeString(file, """
                const handler = (req) => {
                    return transform(req);
                };
                """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units())
                .extracting(CodeUnit::kind, CodeUnit::simpleName)
                .containsExactly(tuple(CodeUnitKind.FUNCTION, "handler"));
    }

    @Test
    void parse_entryPointConvention_setsMetadata() throws Exception {
        Path file = tempDir.resolve("entry.js");
        Files.writeString(file, """
                function handleLogin(req) {
                    return true;
                }
                """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units()).hasSize(1);
        assertThat(result.units().get(0).metadata())
                .containsEntry("is_entry_point", "true");
    }

    @Test
    void parse_builtinCalls_filtered() throws Exception {
        Path file = tempDir.resolve("builtin.js");
        Files.writeString(file, """
                function run(value) {
                    console.log(value);
                    return JSON.stringify(value);
                }
                """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        // console / JSON 是内置符号，不产生 CALLS 边
        assertThat(result.edges()).isEmpty();
    }

    @Test
    void parse_languageIsJavascript() throws Exception {
        Path file = tempDir.resolve("x.js");
        Files.writeString(file, "function f() {}\n");
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));
        assertThat(result.units()).allSatisfy(u -> assertThat(u.language()).isEqualTo("javascript"));
    }
}
