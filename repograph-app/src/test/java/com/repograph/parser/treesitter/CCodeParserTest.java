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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * CCodeParser 单元测试。
 *
 * <p>所有测试在 {@code @BeforeEach} 中通过 {@code assumeTrue(parser.supports("c"))} 检查
 * native 库是否可用；库不可用时测试跳过（而非失败）。
 *
 * @author leolu
 * @since 0.1.0
 */
class CCodeParserTest {

    private CCodeParser parser;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        parser = new CCodeParser();
        assumeTrue(parser.supports("c"), "Tree-sitter C native library not available — skipping tests");
    }

    // ── supports() ───────────────────────────────────────────────────────────

    @Test
    void supports_java_returnsFalse() {
        assertThat(parser.supports("java")).isFalse();
    }

    @Test
    void supports_c_returnsTrue() {
        assertThat(parser.supports("c")).isTrue();
    }

    // ── Empty file ────────────────────────────────────────────────────────────

    @Test
    void parse_emptyFile_returnsEmpty() throws Exception {
        Path file = tempDir.resolve("empty.c");
        Files.writeString(file, "");
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));
        assertThat(result.units()).isEmpty();
        assertThat(result.edges()).isEmpty();
    }

    // ── Simple function ───────────────────────────────────────────────────────

    @Test
    void parse_simpleFunction_extractsFunction() throws Exception {
        Path file = tempDir.resolve("simple.c");
        Files.writeString(file, """
            int add(int a, int b) {
                return a + b;
            }
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units()).hasSize(1);
        CodeUnit fn = result.units().get(0);
        assertThat(fn.kind()).isEqualTo(CodeUnitKind.FUNCTION);
        assertThat(fn.qualifiedName()).isEqualTo("add");
        assertThat(fn.simpleName()).isEqualTo("add");
        assertThat(fn.language()).isEqualTo("c");
        assertThat(fn.startLine()).isEqualTo(1);
        assertThat(fn.metadata()).containsEntry("return_type", "int");
        assertThat(fn.metadata()).containsEntry("visibility", "public");
        assertThat(fn.metadata()).containsEntry("is_static", "false");
    }

    // ── Pointer return function (critical: must extract "foo" not "*") ────────

    @Test
    void parse_pointerReturnFunction_extractsCorrectName() throws Exception {
        Path file = tempDir.resolve("ptr.c");
        Files.writeString(file, """
            char *get_name(int id) {
                return NULL;
            }
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units()).hasSize(1);
        CodeUnit fn = result.units().get(0);
        assertThat(fn.kind()).isEqualTo(CodeUnitKind.FUNCTION);
        assertThat(fn.qualifiedName()).isEqualTo("get_name");
    }

    // ── Static function ───────────────────────────────────────────────────────

    @Test
    void parse_staticFunction_hasFileLocalVisibility() throws Exception {
        Path file = tempDir.resolve("static.c");
        Files.writeString(file, """
            static void helper(void) {
                // internal
            }
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units()).hasSize(1);
        CodeUnit fn = result.units().get(0);
        assertThat(fn.metadata()).containsEntry("visibility", "file-local");
        assertThat(fn.metadata()).containsEntry("is_static", "true");
    }

    // ── Entry point detection ─────────────────────────────────────────────────

    @Test
    void parse_mainFunction_markedAsEntryPoint() throws Exception {
        Path file = tempDir.resolve("main.c");
        Files.writeString(file, """
            int main(int argc, char *argv[]) {
                return 0;
            }
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        assertThat(result.units()).hasSize(1);
        assertThat(result.units().get(0).metadata()).containsEntry("is_entry_point", "true");
    }

    @Test
    void parse_initPrefixFunction_markedAsEntryPoint() throws Exception {
        Path file = tempDir.resolve("module.c");
        Files.writeString(file, """
            void init_module(void) {}
            void internal_helper(void) {}
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<CodeUnit> entryPoints = result.units().stream()
            .filter(u -> "true".equals(u.metadata().get("is_entry_point")))
            .toList();
        assertThat(entryPoints).hasSize(1);
        assertThat(entryPoints.get(0).qualifiedName()).isEqualTo("init_module");
    }

    // ── Struct with fields ────────────────────────────────────────────────────

    @Test
    void parse_structWithFields_extractsStructAndFields() throws Exception {
        Path file = tempDir.resolve("struct.c");
        Files.writeString(file, """
            struct Point {
                int x;
                int y;
            };
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<CodeUnit> structs = result.units().stream()
            .filter(u -> u.kind() == CodeUnitKind.STRUCT).toList();
        assertThat(structs).hasSize(1);
        assertThat(structs.get(0).qualifiedName()).isEqualTo("Point");

        List<CodeUnit> fields = result.units().stream()
            .filter(u -> u.kind() == CodeUnitKind.FIELD).toList();
        assertThat(fields).hasSize(2);
        assertThat(fields).anyMatch(f -> f.qualifiedName().equals("Point.x"));
        assertThat(fields).anyMatch(f -> f.qualifiedName().equals("Point.y"));

        // CONTAINS edges from struct to each field
        List<RelationEdge> contains = result.edges().stream()
            .filter(e -> e.kind() == EdgeKind.CONTAINS).toList();
        assertThat(contains).hasSize(2);
    }

    // ── CALLS edges ───────────────────────────────────────────────────────────

    @Test
    void parse_callExpression_producesCallsEdge() throws Exception {
        Path file = tempDir.resolve("calls.c");
        Files.writeString(file, """
            int compute(int x) { return x * 2; }
            int main_logic(void) { return compute(5); }
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<RelationEdge> calls = result.edges().stream()
            .filter(e -> e.kind() == EdgeKind.CALLS).toList();
        assertThat(calls).hasSize(1);
        RelationEdge edge = calls.get(0);
        assertThat(edge.resolved()).isTrue();

        // Caller should be main_logic, target should be compute
        CodeUnit caller = result.units().stream()
            .filter(u -> "main_logic".equals(u.qualifiedName())).findFirst().orElseThrow();
        assertThat(edge.sourceId()).isEqualTo(caller.id());
    }

    // ── Builtin symbols not producing CALLS edges ─────────────────────────────

    @Test
    void parse_builtinCallsFiltered_noCallsEdgeForPrintf() throws Exception {
        Path file = tempDir.resolve("builtin.c");
        Files.writeString(file, """
            #include <stdio.h>
            void greet(void) {
                printf("hello\\n");
            }
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<RelationEdge> calls = result.edges().stream()
            .filter(e -> e.kind() == EdgeKind.CALLS).toList();
        assertThat(calls).isEmpty();
    }

    // ── Local include IMPORTS edge ────────────────────────────────────────────

    @Test
    void parse_localInclude_producesImportsEdge() throws Exception {
        Path header = tempDir.resolve("util.h");
        Files.writeString(header, "void helper(void);");
        Path file = tempDir.resolve("main.c");
        Files.writeString(file, """
            #include "util.h"
            int main(void) { return 0; }
            """);

        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<RelationEdge> imports = result.edges().stream()
            .filter(e -> e.kind() == EdgeKind.IMPORTS).toList();
        assertThat(imports).hasSize(1);
        assertThat(imports.get(0).targetId()).isEqualTo("util.h");
        assertThat(imports.get(0).resolved()).isTrue();
    }

    // ── System include not producing IMPORTS edge ─────────────────────────────

    @Test
    void parse_systemInclude_noImportsEdge() throws Exception {
        Path file = tempDir.resolve("sys.c");
        Files.writeString(file, """
            #include <stdio.h>
            void noop(void) {}
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<RelationEdge> imports = result.edges().stream()
            .filter(e -> e.kind() == EdgeKind.IMPORTS).toList();
        assertThat(imports).isEmpty();
    }

    // ── Macro ─────────────────────────────────────────────────────────────────

    @Test
    void parse_macroDefine_extractsMacro() throws Exception {
        Path file = tempDir.resolve("macros.c");
        Files.writeString(file, """
            #define MAX_SIZE 1024
            #define SQUARE(x) ((x)*(x))
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<CodeUnit> macros = result.units().stream()
            .filter(u -> u.kind() == CodeUnitKind.MACRO).toList();
        assertThat(macros).hasSize(2);
        assertThat(macros).anyMatch(m -> "MAX_SIZE".equals(m.qualifiedName()));
        assertThat(macros).anyMatch(m -> "SQUARE".equals(m.qualifiedName()));
    }

    // ── Function declaration ──────────────────────────────────────────────────

    @Test
    void parse_functionDeclaration_setsIsDeclaration() throws Exception {
        Path file = tempDir.resolve("header.c");
        Files.writeString(file, """
            int calculate(int a, int b);
            void process(void);
            """);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        List<CodeUnit> decls = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.FUNCTION)
                .filter(u -> "true".equals(u.metadata().get("is_declaration")))
                .toList();
        assertThat(decls).isNotEmpty();
        assertThat(decls).anyMatch(d -> "calculate".equals(d.qualifiedName())
                                     || "process".equals(d.qualifiedName()));
    }

    // ── Enum / Union / Typedef ────────────────────────────────────────────────

    @Test
    void parse_enumSpecifier_extractsEnum() throws Exception {
        Path file = tempDir.resolve("color.c");
        Files.writeString(file, """
            enum Color { RED, GREEN, BLUE };
            void use_color(enum Color c) {}
            """);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        List<CodeUnit> enums = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.ENUM).toList();
        assertThat(enums).isNotEmpty();
        assertThat(enums).anyMatch(e -> "Color".equals(e.qualifiedName()));
    }

    @Test
    void parse_typedef_extractsTypedef() throws Exception {
        Path file = tempDir.resolve("types.c");
        Files.writeString(file, """
            typedef unsigned int uint32;
            typedef struct { int x; int y; } Point;
            """);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        List<CodeUnit> typedefs = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.TYPEDEF).toList();
        assertThat(typedefs).isNotEmpty();
        assertThat(typedefs).anyMatch(t -> "uint32".equals(t.qualifiedName())
                                       || "Point".equals(t.qualifiedName()));
    }

    @Test
    void parse_unionSpecifier_extractsUnion() throws Exception {
        Path file = tempDir.resolve("data.c");
        Files.writeString(file, """
            union Data {
                int i;
                float f;
            };
            """);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        List<CodeUnit> unions = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.UNION).toList();
        assertThat(unions).isNotEmpty();
        assertThat(unions).anyMatch(u -> "Data".equals(u.qualifiedName()));
    }

    // ── Syntax error file ─────────────────────────────────────────────────────

    @Test
    void parse_syntaxErrorFile_returnsPartialResultNotNull() throws Exception {
        Path file = tempDir.resolve("broken.c");
        Files.writeString(file, """
            int valid_fn(void) { return 0; }
            int broken(void {  // missing )
            """);
        // Should not throw, may return partial or empty result
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));
        assertThat(result).isNotNull();
        assertThat(result.units()).isNotNull();
    }
}
