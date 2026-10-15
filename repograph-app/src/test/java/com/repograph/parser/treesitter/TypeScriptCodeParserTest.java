package com.repograph.parser.treesitter;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
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
 * {@link TypeScriptCodeParser} 单元测试。
 *
 * <p>所有测试在 {@code @BeforeEach} 中通过 {@code assumeTrue(parser.supports("typescript"))}
 * 检查 native 库是否可用；库不可用时测试跳过（而非失败）。
 *
 * @author leolu
 * @since 0.6.0
 */
class TypeScriptCodeParserTest {

    private TypeScriptCodeParser parser;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        parser = new TypeScriptCodeParser();
        assumeTrue(parser.supports("typescript"),
                "Tree-sitter TypeScript native library not available — skipping tests");
    }

    @Test
    void supports_javascript_returnsFalse() {
        assertThat(parser.supports("javascript")).isFalse();
    }

    @Test
    void parse_typeDeclarations_extractsKinds() throws Exception {
        Path file = tempDir.resolve("types.ts");
        Files.writeString(file, """
                export interface Repo {
                    find(id: string): Promise<User>;
                }

                export type Loader = (id: string) => Promise<User>;

                enum Status {
                    Active,
                }
                """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units())
                .extracting(CodeUnit::kind, CodeUnit::simpleName)
                .containsExactlyInAnyOrder(
                        tuple(CodeUnitKind.INTERFACE, "Repo"),
                        tuple(CodeUnitKind.TYPEDEF, "Loader"),
                        tuple(CodeUnitKind.ENUM, "Status"));
    }

    @Test
    void parse_abstractClass_andTypedMethod() throws Exception {
        Path file = tempDir.resolve("base.ts");
        Files.writeString(file, """
                abstract class BaseRepo {
                    protected cache: Map<string, User> = new Map();

                    abstract find(id: string): Promise<User>;
                }

                class UserRepo extends BaseRepo {
                    find(id: string): Promise<User> {
                        return this.load(id);
                    }
                }
                """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units())
                .extracting(CodeUnit::kind, CodeUnit::qualifiedName)
                .contains(
                        tuple(CodeUnitKind.CLASS, "BaseRepo"),
                        tuple(CodeUnitKind.CLASS, "UserRepo"),
                        tuple(CodeUnitKind.METHOD, "BaseRepo.find"),
                        tuple(CodeUnitKind.METHOD, "UserRepo.find"));

        assertThat(result.units())
                .filteredOn(u -> "BaseRepo".equals(u.simpleName()))
                .singleElement()
                .satisfies(u -> assertThat(u.metadata()).containsEntry("is_abstract", "true"));
    }

    @Test
    void parse_tsxComponent_usesTsxGrammar() throws Exception {
        Path file = tempDir.resolve("App.tsx");
        Files.writeString(file, """
                const App = () => {
                    return <div>hello</div>;
                };
                """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units())
                .extracting(CodeUnit::kind, CodeUnit::simpleName)
                .containsExactly(tuple(CodeUnitKind.FUNCTION, "App"));
    }

    @Test
    void parse_languageIsTypescript() throws Exception {
        Path file = tempDir.resolve("x.ts");
        Files.writeString(file, "function f(): void {}\n");
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));
        assertThat(result.units()).allSatisfy(u -> assertThat(u.language()).isEqualTo("typescript"));
    }
}
