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
 * PythonCodeParser 单元测试。
 *
 * <p>所有测试在 {@code @BeforeEach} 中通过 {@code assumeTrue(parser.supports("python"))} 检查
 * native 库是否可用；库不可用时测试跳过（而非失败）。
 *
 * @author leolu
 * @since 0.1.0
 */
class PythonCodeParserTest {

    private PythonCodeParser parser;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        parser = new PythonCodeParser();
        assumeTrue(parser.supports("python"), "Tree-sitter Python native library not available — skipping tests");
    }

    // ── supports() ───────────────────────────────────────────────────────────

    @Test
    void supports_java_returnsFalse() {
        assertThat(parser.supports("java")).isFalse();
    }

    @Test
    void supports_python_returnsTrue() {
        assertThat(parser.supports("python")).isTrue();
    }

    // ── Empty file ────────────────────────────────────────────────────────────

    @Test
    void parse_emptyFile_returnsEmpty() throws Exception {
        Path file = tempDir.resolve("empty.py");
        Files.writeString(file, "");
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));
        assertThat(result.units()).isEmpty();
        assertThat(result.edges()).isEmpty();
    }

    // ── Simple class ──────────────────────────────────────────────────────────

    @Test
    void parse_simpleClass_extractsClass() throws Exception {
        Path file = tempDir.resolve("simple.py");
        Files.writeString(file, """
            class MyClass:
                pass
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<CodeUnit> classes = result.units().stream()
            .filter(u -> u.kind() == CodeUnitKind.CLASS).toList();
        assertThat(classes).hasSize(1);
        CodeUnit cls = classes.get(0);
        assertThat(cls.qualifiedName()).isEqualTo("MyClass");
        assertThat(cls.simpleName()).isEqualTo("MyClass");
        assertThat(cls.language()).isEqualTo("python");
    }

    // ── Method extraction ─────────────────────────────────────────────────────

    @Test
    void parse_classWithMethod_extractsMethod() throws Exception {
        Path file = tempDir.resolve("method.py");
        Files.writeString(file, """
            class Greeter:
                def greet(self, name):
                    return "hello " + name
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<CodeUnit> methods = result.units().stream()
            .filter(u -> u.kind() == CodeUnitKind.METHOD).toList();
        assertThat(methods).hasSize(1);
        CodeUnit m = methods.get(0);
        assertThat(m.qualifiedName()).isEqualTo("Greeter#greet");
        assertThat(m.simpleName()).isEqualTo("greet");
        assertThat(m.parentQualifiedName()).isEqualTo("Greeter");
    }

    // ── CONTAINS edge ─────────────────────────────────────────────────────────

    @Test
    void parse_classWithMethod_producesContainsEdge() throws Exception {
        Path file = tempDir.resolve("contains.py");
        Files.writeString(file, """
            class Calculator:
                def add(self, a, b):
                    return a + b
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<RelationEdge> contains = result.edges().stream()
            .filter(e -> e.kind() == EdgeKind.CONTAINS).toList();
        assertThat(contains).hasSize(1);
    }

    // ── async def ────────────────────────────────────────────────────────────

    @Test
    void parse_asyncMethod_extractedWithAsyncMetadata() throws Exception {
        Path file = tempDir.resolve("async_method.py");
        Files.writeString(file, """
            class AsyncService:
                async def fetch(self, url):
                    pass
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<CodeUnit> methods = result.units().stream()
            .filter(u -> u.kind() == CodeUnitKind.METHOD).toList();
        assertThat(methods).hasSize(1);
        assertThat(methods.get(0).metadata()).containsEntry("is_async", "true");
    }

    // ── Decorator extraction ──────────────────────────────────────────────────

    @Test
    void parse_methodWithDecorator_extractsAnnotation() throws Exception {
        Path file = tempDir.resolve("decorator.py");
        Files.writeString(file, """
            class Service:
                @staticmethod
                def create():
                    return Service()
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<CodeUnit> methods = result.units().stream()
            .filter(u -> u.kind() == CodeUnitKind.METHOD).toList();
        assertThat(methods).hasSize(1);
        assertThat(methods.get(0).annotations()).anyMatch(a -> a.contains("staticmethod"));
    }

    // ── Type annotations ──────────────────────────────────────────────────────

    @Test
    void parse_methodWithReturnTypeAnnotation_extractsReturnType() throws Exception {
        Path file = tempDir.resolve("typed.py");
        Files.writeString(file, """
            class Converter:
                def to_int(self, value: str) -> int:
                    return int(value)
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<CodeUnit> methods = result.units().stream()
            .filter(u -> u.kind() == CodeUnitKind.METHOD).toList();
        assertThat(methods).hasSize(1);
        assertThat(methods.get(0).metadata()).containsKey("return_type");
        assertThat(methods.get(0).metadata().get("return_type")).isEqualTo("int");
    }

    // ── Top-level function ────────────────────────────────────────────────────

    @Test
    void parse_topLevelFunction_extractsMethodWithoutClassName() throws Exception {
        Path file = tempDir.resolve("utils.py");
        Files.writeString(file, """
            def add(a: int, b: int) -> int:
                return a + b

            def greet(name: str) -> str:
                return f"Hello {name}"
            """);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        List<CodeUnit> methods = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.METHOD).toList();
        assertThat(methods).hasSize(2);
        // Top-level function: qualifiedName is just the function name (no ClassName# prefix)
        assertThat(methods).anyMatch(m -> "add".equals(m.qualifiedName()));
        assertThat(methods).anyMatch(m -> "greet".equals(m.qualifiedName()));
        assertThat(methods.get(0).parentQualifiedName()).isNull();
    }

    // ── IMPORTS edges ────────────────────────────────────────────────────────

    @Test
    void parse_importStatement_producesUnresolvedImportsEdge() throws Exception {
        Path file = tempDir.resolve("client.py");
        Files.writeString(file, """
            import os
            import json

            def run():
                pass
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<RelationEdge> imports = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.IMPORTS).toList();
        assertThat(imports).hasSizeGreaterThanOrEqualTo(2);
        assertThat(imports).anyMatch(e -> e.targetId().equals("os"));
        assertThat(imports).anyMatch(e -> e.targetId().equals("json"));
        assertThat(imports.get(0).resolved()).isFalse();
    }

    @Test
    void parse_importFrom_producesImportsEdge() throws Exception {
        Path file = tempDir.resolve("service.py");
        Files.writeString(file, """
            from pathlib import Path
            from os.path import join

            def work():
                pass
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<RelationEdge> imports = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.IMPORTS).toList();
        assertThat(imports).hasSizeGreaterThanOrEqualTo(2);
        assertThat(imports).anyMatch(e -> e.targetId().equals("pathlib"));
        assertThat(imports).anyMatch(e -> e.targetId().equals("os.path"));
    }

    @Test
    void parse_importLocalModule_producesResolvedImportsEdge() throws Exception {
        // Create a local utils.py in the same tempDir so import resolves
        Files.writeString(tempDir.resolve("utils.py"), "def helper(): pass\n");
        Path file = tempDir.resolve("main.py");
        Files.writeString(file, """
            import utils

            def run():
                utils.helper()
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<RelationEdge> imports = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.IMPORTS).toList();
        assertThat(imports).anyMatch(e -> e.resolved() && e.targetId().equals("utils.py"));
    }

    // ── CALLS edges ──────────────────────────────────────────────────────────

    @Test
    void parse_selfMethodCall_producesCallsEdge() throws Exception {
        Path file = tempDir.resolve("service.py");
        Files.writeString(file, """
            class Service:
                def handle(self):
                    self.process()

                def process(self):
                    pass
            """);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit handle = result.units().stream()
                .filter(u -> "Service#handle".equals(u.qualifiedName())).findFirst().orElse(null);
        CodeUnit process = result.units().stream()
                .filter(u -> "Service#process".equals(u.qualifiedName())).findFirst().orElse(null);
        assertThat(handle).isNotNull();
        assertThat(process).isNotNull();

        boolean hasCall = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS && e.sourceId().equals(handle.id()))
                .anyMatch(e -> e.targetId().equals(process.id()));
        assertThat(hasCall).as("handle() should CALLS process() via self.process()").isTrue();
    }

    @Test
    void parse_directFunctionCall_producesCallsEdge() throws Exception {
        Path file = tempDir.resolve("utils.py");
        Files.writeString(file, """
            def helper():
                pass

            def main():
                helper()
            """);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit main = result.units().stream()
                .filter(u -> "main".equals(u.qualifiedName())).findFirst().orElse(null);
        CodeUnit helper = result.units().stream()
                .filter(u -> "helper".equals(u.qualifiedName())).findFirst().orElse(null);
        assertThat(main).isNotNull();
        assertThat(helper).isNotNull();

        boolean hasCall = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS && e.sourceId().equals(main.id()))
                .anyMatch(e -> e.targetId().equals(helper.id()));
        assertThat(hasCall).as("main() should CALLS helper()").isTrue();
    }

    @Test
    void parse_selfForwardReference_producesCallsEdge() throws Exception {
        // process() calls validate() defined AFTER it in the file
        Path file = tempDir.resolve("forward.py");
        Files.writeString(file, """
            class Processor:
                def process(self):
                    self.validate()

                def validate(self):
                    pass
            """);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit process = result.units().stream()
                .filter(u -> "Processor#process".equals(u.qualifiedName())).findFirst().orElse(null);
        CodeUnit validate = result.units().stream()
                .filter(u -> "Processor#validate".equals(u.qualifiedName())).findFirst().orElse(null);
        assertThat(process).isNotNull();
        assertThat(validate).isNotNull();

        boolean hasCall = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS && e.sourceId().equals(process.id()))
                .anyMatch(e -> e.targetId().equals(validate.id()));
        assertThat(hasCall).as("process() should CALLS forward-declared validate()").isTrue();
    }

    // ── EXTENDS edges ─────────────────────────────────────────────────────────

    @Test
    void parse_classInherits_producesExtendsEdge() throws Exception {
        Path file = tempDir.resolve("inherit.py");
        Files.writeString(file, """
            class Animal:
                def speak(self):
                    pass

            class Dog(Animal):
                def speak(self):
                    return "woof"
            """);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit dog = result.units().stream()
                .filter(u -> "Dog".equals(u.qualifiedName())).findFirst().orElse(null);
        CodeUnit animal = result.units().stream()
                .filter(u -> "Animal".equals(u.qualifiedName())).findFirst().orElse(null);
        assertThat(dog).isNotNull();
        assertThat(animal).isNotNull();

        boolean hasExtends = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.EXTENDS && e.sourceId().equals(dog.id()))
                .anyMatch(e -> e.targetId().equals(animal.id()));
        assertThat(hasExtends).as("Dog should EXTENDS Animal").isTrue();
    }

    @Test
    void parse_classExtendsExternal_producesUnresolvedExtendsEdge() throws Exception {
        Path file = tempDir.resolve("ext_inherit.py");
        Files.writeString(file, """
            class MyView(View):
                pass
            """);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasExtends = result.edges().stream()
                .anyMatch(e -> e.kind() == EdgeKind.EXTENDS && e.targetId().contains("View"));
        assertThat(hasExtends).as("MyView should have unresolved EXTENDS edge to View").isTrue();
    }

    // ── Syntax error ──────────────────────────────────────────────────────────

    @Test
    void parse_syntaxErrorFile_returnsNonNullResult() throws Exception {
        Path file = tempDir.resolve("broken.py");
        Files.writeString(file, """
            class Broken
                def incomplete(
            """);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));
        assertThat(result).isNotNull();
        assertThat(result.units()).isNotNull();
    }
}
