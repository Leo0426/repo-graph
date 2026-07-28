package com.repograph.parser.java;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.model.RelationEdge;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * JavaCodeParser 单元测试。
 *
 * @author leolu
 * @since 0.1.0
 */
class JavaCodeParserTest {

    private JavaCodeParser parser;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        parser = new JavaCodeParser();
    }

    @Test
    void parse_emptyFile_returnsEmptyResult() throws Exception {
        Path file = writeSource("Empty.java", "");
        ParseResult result = parser.parse(file, ParseOptions.defaults());
        assertTrue(result.units().isEmpty());
        assertTrue(result.edges().isEmpty());
    }

    @Test
    void parse_simpleClass_extractsClassAndMethods() throws Exception {
        String source = """
                package com.example;

                public class Foo {
                    private String name;

                    public void doSomething(String s) {
                        System.out.println(s);
                    }

                    public String getName() {
                        return name;
                    }
                }
                """;
        Path file = writeSource("Foo.java", source);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<CodeUnit> units = result.units();
        assertFalse(units.isEmpty());

        CodeUnit clazz = findUnit(units, CodeUnitKind.CLASS);
        assertNotNull(clazz);
        assertEquals("com.example.Foo", clazz.qualifiedName());
        assertEquals("Foo", clazz.simpleName());
        assertEquals("java", clazz.language());
        assertEquals("public", clazz.metadata().get("visibility"));

        CodeUnit doSomething = findUnitBySimpleName(units, "doSomething");
        assertNotNull(doSomething);
        assertEquals(CodeUnitKind.METHOD, doSomething.kind());
        assertEquals("com.example.Foo#doSomething(String)", doSomething.qualifiedName());
        assertEquals("void", doSomething.metadata().get("return_type"));
        assertEquals("String", doSomething.metadata().get("param_types"));
        assertEquals("com.example.Foo", doSomething.parentQualifiedName());
    }

    @Test
    void parse_nestedClass_usesNestedSeparator() throws Exception {
        String source = """
                package com.example;

                public class Outer {
                    public static class Inner {
                        public void innerMethod() {}
                    }
                }
                """;
        Path file = writeSource("Outer.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit innerClass = result.units().stream()
                .filter(u -> u.simpleName().equals("Inner"))
                .findFirst().orElse(null);
        assertNotNull(innerClass);
        assertEquals("com.example.Outer$Inner", innerClass.qualifiedName());
    }

    @Test
    void parse_springAnnotations_setsEntryPointAndFramework() throws Exception {
        String source = """
                package com.example;

                import org.springframework.web.bind.annotation.RestController;
                import org.springframework.web.bind.annotation.GetMapping;

                @RestController
                public class UserController {
                    @GetMapping("/users")
                    public String getUsers() { return "[]"; }
                }
                """;
        Path file = writeSource("UserController.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit ctrl = findUnit(result.units(), CodeUnitKind.CLASS);
        assertNotNull(ctrl);
        assertTrue(ctrl.annotations().contains("@RestController"));
        assertEquals("true", ctrl.metadata().get("is_entry_point"));

        CodeUnit getUsers = findUnitBySimpleName(result.units(), "getUsers");
        assertNotNull(getUsers);
        assertEquals("true", getUsers.metadata().get("is_entry_point"));
    }

    @Test
    void parse_testAnnotation_setsIsTest() throws Exception {
        String source = """
                package com.example;

                import org.junit.jupiter.api.Test;

                class FooTest {
                    @Test
                    void shouldDoSomething() {}
                }
                """;
        Path file = writeSource("FooTest.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit testMethod = findUnitBySimpleName(result.units(), "shouldDoSomething");
        assertNotNull(testMethod);
        assertEquals("true", testMethod.metadata().get("is_test"));
    }

    @Test
    void parse_interface_extractsInterface() throws Exception {
        String source = """
                package com.example;

                public interface FooService {
                    void doFoo(String arg);
                }
                """;
        Path file = writeSource("FooService.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit iface = findUnit(result.units(), CodeUnitKind.INTERFACE);
        assertNotNull(iface);
        assertEquals("com.example.FooService", iface.qualifiedName());
    }

    @Test
    void parse_enum_extractsEnum() throws Exception {
        String source = """
                package com.example;

                public enum Status {
                    ACTIVE, INACTIVE;
                }
                """;
        Path file = writeSource("Status.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit enumUnit = findUnit(result.units(), CodeUnitKind.ENUM);
        assertNotNull(enumUnit);
        assertEquals("com.example.Status", enumUnit.qualifiedName());
    }

    @Test
    void parse_recordClass_setsIsRecord() throws Exception {
        String source = """
                package com.example;

                public record Point(int x, int y) {}
                """;
        Path file = writeSource("Point.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit record = findUnit(result.units(), CodeUnitKind.CLASS);
        assertNotNull(record);
        assertEquals("com.example.Point", record.qualifiedName());
        assertEquals("true", record.metadata().get("is_record"));
    }

    @Test
    void parse_extendsImplements_producesEdges() throws Exception {
        String source = """
                package com.example;

                public class FooImpl extends BaseImpl implements FooService {
                    @Override
                    public void doFoo(String arg) {}
                }
                """;
        Path file = writeSource("FooImpl.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasExtends = result.edges().stream()
                .anyMatch(e -> e.kind() == EdgeKind.EXTENDS);
        boolean hasImplements = result.edges().stream()
                .anyMatch(e -> e.kind() == EdgeKind.IMPLEMENTS);
        assertTrue(hasExtends, "Should have EXTENDS edge");
        assertTrue(hasImplements, "Should have IMPLEMENTS edge");
    }

    @Test
    void parse_syntaxError_returnsEmptyWithoutThrowing() throws Exception {
        Path file = writeSource("Broken.java", "public class { this is not valid java !@#$");
        ParseResult result = parser.parse(file, ParseOptions.defaults());
        // Should return empty/partial, not throw
        assertNotNull(result);
    }

    @Test
    void parse_containsEdges_methodHasContainsEdge() throws Exception {
        String source = """
                package com.example;

                public class Foo {
                    public void bar() {}
                }
                """;
        Path file = writeSource("Foo.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasContains = result.edges().stream()
                .anyMatch(e -> e.kind() == EdgeKind.CONTAINS);
        assertTrue(hasContains, "Should have CONTAINS edge from class to method");
    }

    @Test
    void parse_fieldDeclaration_extractsField() throws Exception {
        String source = """
                package com.example;

                public class Foo {
                    private final String name;
                    private int count;
                }
                """;
        Path file = writeSource("Foo.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        List<CodeUnit> fields = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.FIELD)
                .toList();
        assertEquals(2, fields.size());
        assertTrue(fields.stream().anyMatch(f -> f.simpleName().equals("name")));
        assertTrue(fields.stream().anyMatch(f -> f.simpleName().equals("count")));
    }

    @Test
    void parse_methodCallsProduceCallsEdges() throws Exception {
        String source = """
                package com.example;

                public class Foo {
                    public void caller() {
                        helper();
                    }

                    public void helper() {}
                }
                """;
        Path file = writeSource("Foo.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasCallsEdge = result.edges().stream()
                .anyMatch(e -> e.kind() == EdgeKind.CALLS);
        assertTrue(hasCallsEdge, "Should have CALLS edge from caller to helper");
    }

    @Test
    void parse_staticMethod_setsIsStatic() throws Exception {
        String source = """
                package com.example;

                public class Util {
                    public static String format(String s) { return s; }
                }
                """;
        Path file = writeSource("Util.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit method = findUnitBySimpleName(result.units(), "format");
        assertNotNull(method);
        assertEquals("true", method.metadata().get("is_static"));
    }

    // ── Edge types: IMPORTS / DEFINES_TYPE / constructor CALLS / method ref ──

    @Test
    void parse_importStatement_producesImportsEdge() throws Exception {
        String source = """
                package com.example;

                import com.other.SomeService;

                public class Client {
                    public void use(SomeService svc) {}
                }
                """;
        Path file = writeSource("Client.java", source);
        // withProjectRoot required so processImportEdges runs
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<RelationEdge> imports = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.IMPORTS)
                .toList();
        assertFalse(imports.isEmpty(), "Should produce IMPORTS edge for import statement");
        // SomeService.java is not in tempDir → unresolved
        RelationEdge edge = imports.get(0);
        assertFalse(edge.resolved(), "IMPORTS edge should be unresolved when target not in project");
        assertTrue(edge.targetId().contains("SomeService") || edge.targetId().contains("com.other"),
                "Target should reference the imported type");
    }

    @Test
    void parse_methodParameter_producesDefinesTypeEdge() throws Exception {
        String source = """
                package com.example;

                public class Client {
                    public void process(UserService svc) {}
                }
                """;
        Path file = writeSource("Client.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasDefinesType = result.edges().stream()
                .anyMatch(e -> e.kind() == EdgeKind.DEFINES_TYPE);
        assertTrue(hasDefinesType, "Should produce DEFINES_TYPE edge for non-primitive parameter");
    }

    @Test
    void parse_constructorCall_producesCallsEdge() throws Exception {
        String source = """
                package com.example;

                public class Factory {
                    public Object create() {
                        return new StringBuilder();
                    }
                }
                """;
        Path file = writeSource("Factory.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasCtorCall = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS)
                .anyMatch(e -> e.targetId().contains("<init>") || e.targetId().contains("StringBuilder"));
        assertTrue(hasCtorCall, "Should produce CALLS edge for constructor invocation (new Foo())");
    }

    @Test
    void parse_methodReference_producesCallsEdge() throws Exception {
        String source = """
                package com.example;

                import java.util.List;

                public class Printer {
                    public void printAll(List<String> items) {
                        items.forEach(System.out::println);
                    }
                }
                """;
        Path file = writeSource("Printer.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasMethodRefCall = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS)
                .anyMatch(e -> e.targetId().contains("println"));
        assertTrue(hasMethodRefCall, "Should produce CALLS edge for method reference (System.out::println)");
    }

    // ── Constructor / Annotation type ─────────────────────────────────────────

    @Test
    void parse_constructor_extractsConstructorUnit() throws Exception {
        String source = """
                package com.example;

                public class Service {
                    public Service(String name, int port) {}
                }
                """;
        Path file = writeSource("Service.java", source);
        ParseResult result = parser.parse(file, ParseOptions.withProjectRoot(tempDir));

        List<CodeUnit> constructors = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.CONSTRUCTOR)
                .toList();
        assertFalse(constructors.isEmpty(), "Should extract at least one constructor");
        CodeUnit ctor = constructors.get(0);
        assertTrue(ctor.qualifiedName().startsWith("com.example.Service#Service"),
                "Constructor qualifiedName should start with class#ClassName");
        assertEquals("com.example.Service", ctor.parentQualifiedName());
        assertEquals("public", ctor.metadata().get("visibility"));
    }

    @Test
    void parse_annotationType_extractsAnnotationKind() throws Exception {
        String source = """
                package com.example;

                public @interface Logged {
                    String level() default "INFO";
                }
                """;
        Path file = writeSource("Logged.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit annotation = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.ANNOTATION)
                .findFirst().orElse(null);
        assertNotNull(annotation, "Should extract annotation type declaration");
        assertEquals("com.example.Logged", annotation.qualifiedName());
    }

    // ── Method modifiers ───────────────────────────────────────────────────────

    @Test
    void parse_abstractMethod_setsIsAbstract() throws Exception {
        String source = """
                package com.example;

                public abstract class Base {
                    public abstract void process(String input);
                }
                """;
        Path file = writeSource("Base.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit method = findUnitBySimpleName(result.units(), "process");
        assertNotNull(method);
        assertEquals("true", method.metadata().get("is_abstract"));
        assertEquals("void", method.metadata().get("return_type"));
    }

    @Test
    void parse_finalMethod_setsIsFinal() throws Exception {
        String source = """
                package com.example;

                public class Immutable {
                    public final String getValue() { return ""; }
                }
                """;
        Path file = writeSource("Immutable.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit method = findUnitBySimpleName(result.units(), "getValue");
        assertNotNull(method);
        assertEquals("true", method.metadata().get("is_final"));
    }

    @Test
    void parse_privateMethod_setsPrivateVisibility() throws Exception {
        String source = """
                package com.example;

                public class Foo {
                    private void secret() {}
                    protected void half() {}
                }
                """;
        Path file = writeSource("Foo.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit secret = findUnitBySimpleName(result.units(), "secret");
        assertNotNull(secret);
        assertEquals("private", secret.metadata().get("visibility"));

        CodeUnit half = findUnitBySimpleName(result.units(), "half");
        assertNotNull(half);
        assertEquals("protected", half.metadata().get("visibility"));
    }

    @Test
    void parse_frameworkCallbackInterfaceOverride_marksEntryPoint() throws Exception {
        // Real-world finding from WebGoat validation: HandlerInterceptor#preHandle is invoked
        // directly by the Spring MVC framework (via addInterceptors registration) with no
        // explicit in-repo caller and no @RequestMapping-style annotation, so the existing
        // annotation-only entry-point detection misses it entirely.
        String source = """
                package com.example;

                import org.springframework.web.servlet.HandlerInterceptor;
                import jakarta.servlet.http.HttpServletRequest;
                import jakarta.servlet.http.HttpServletResponse;

                public class UserInterceptor implements HandlerInterceptor {
                    @Override
                    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                        return true;
                    }

                    private void helper() {
                    }
                }
                """;
        Path file = writeSource("UserInterceptor.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit preHandle = findUnitBySimpleName(result.units(), "preHandle");
        assertNotNull(preHandle);
        assertEquals("true", preHandle.metadata().get("is_entry_point"),
                "Override of a known framework callback interface method should be marked as entry point");

        CodeUnit helper = findUnitBySimpleName(result.units(), "helper");
        assertNotNull(helper);
        assertNull(helper.metadata().get("is_entry_point"),
                "Plain private methods in the same class should not be marked as entry points");
    }

    @Test
    void parse_overrideAnnotation_producesOverridesEdge() throws Exception {
        String source = """
                package com.example;

                public class FooImpl extends Base {
                    @Override
                    public void doFoo() {}
                }
                """;
        Path file = writeSource("FooImpl.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasOverrides = result.edges().stream()
                .anyMatch(e -> e.kind() == EdgeKind.OVERRIDES);
        assertTrue(hasOverrides, "Should have OVERRIDES edge for @Override method");
    }

    // ── Precision improvements ────────────────────────────────────────────────

    @Test
    void parse_annotationAttributes_storedInMetadata() throws Exception {
        String source = """
                package com.example;

                import org.springframework.web.bind.annotation.RequestMapping;
                import org.springframework.web.bind.annotation.GetMapping;

                @RequestMapping("/api")
                public class ApiController {
                    @GetMapping("/users")
                    public String getUsers() { return "[]"; }
                }
                """;
        Path file = writeSource("ApiController.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit ctrl = findUnit(result.units(), CodeUnitKind.CLASS);
        assertNotNull(ctrl);
        assertEquals("/api", ctrl.metadata().get("ann_RequestMapping"),
                "Should extract @RequestMapping path attribute");

        CodeUnit method = findUnitBySimpleName(result.units(), "getUsers");
        assertNotNull(method);
        assertEquals("/users", method.metadata().get("ann_GetMapping"),
                "Should extract @GetMapping path attribute");
    }

    @Test
    void parse_springAuthorizationAnnotationsAndPatchRoute_preserveEvidence() throws Exception {
        String source = """
                package com.example;

                import org.springframework.security.access.prepost.PreAuthorize;
                import org.springframework.web.bind.annotation.PatchMapping;
                import org.springframework.web.bind.annotation.RequestMapping;

                @RequestMapping("/api/users")
                @PreAuthorize("hasRole('ADMIN')")
                public class UserController {
                    @PatchMapping("/{id}")
                    @PreAuthorize("#id == authentication.name")
                    public String update(String id) { return id; }
                }
                """;
        Path file = writeSource("UserController.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit controller = findUnit(result.units(), CodeUnitKind.CLASS);
        CodeUnit method = findUnitBySimpleName(result.units(), "update");

        assertNotNull(controller);
        assertNotNull(method);
        assertEquals("hasRole('ADMIN')", controller.metadata().get("ann_PreAuthorize"));
        assertEquals("#id == authentication.name", method.metadata().get("ann_PreAuthorize"));
        assertEquals("/{id}", method.metadata().get("ann_PatchMapping"));
        assertEquals("true", method.metadata().get("is_entry_point"));
    }

    @Test
    void parse_staticImport_resolvesCall() throws Exception {
        String source = """
                package com.example;

                import static java.util.Collections.emptyList;

                public class Util {
                    public java.util.List<String> getEmpty() {
                        return emptyList();
                    }
                }
                """;
        Path file = writeSource("Util.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        RelationEdge call = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS)
                .filter(e -> e.targetId().contains("Collections"))
                .findFirst().orElseThrow();
        assertEquals("java.util.Collections#emptyList()", call.targetId());
        assertFalse(call.resolved(), "External static import remains unresolved until a matching node exists");
    }

    @Test
    void parse_staticWildcardImport_resolvesCallOwner() throws Exception {
        String source = """
                package com.example;

                import static com.other.Assertions.*;

                public class Validator {
                    public void validate(String value) {
                        requireValid(value);
                    }
                }
                """;
        Path file = writeSource("Validator.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        RelationEdge call = result.edges().stream()
                .filter(edge -> edge.kind() == EdgeKind.CALLS)
                .filter(edge -> edge.targetId().contains("requireValid"))
                .findFirst().orElseThrow();
        assertEquals("com.other.Assertions#requireValid(String)", call.targetId());
        assertFalse(call.resolved());
    }

    @Test
    void parse_fieldInitializer_producesCallsEdge() throws Exception {
        String source = """
                package com.example;

                import java.util.ArrayList;

                public class Repo {
                    private java.util.List<String> items = new ArrayList<>();

                    public void process() {
                        items.clear();
                    }
                }
                """;
        Path file = writeSource("Repo.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasInitCalls = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS)
                .anyMatch(e -> e.targetId().contains("ArrayList") || e.targetId().contains("<init>"));
        assertTrue(hasInitCalls, "Should produce CALLS edge from field initializer constructor");
    }

    @Test
    void parse_returnType_producesDefinesTypeEdge() throws Exception {
        String source = """
                package com.example;

                public class Factory {
                    public UserService create() { return null; }
                }
                """;
        Path file = writeSource("Factory.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit method = findUnitBySimpleName(result.units(), "create");
        assertNotNull(method);
        boolean hasReturnTypeEdge = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.DEFINES_TYPE)
                .anyMatch(e -> e.sourceId().equals(method.id()) && e.targetId().contains("UserService"));
        assertTrue(hasReturnTypeEdge, "Should produce DEFINES_TYPE edge for non-primitive return type");
    }

    @Test
    void parse_overloadedMethods_disambiguatesByArgCount() throws Exception {
        String source = """
                package com.example;

                public class Processor {
                    public void run() {}
                    public void run(String input) {}

                    public void caller() {
                        run("hello");
                    }
                }
                """;
        Path file = writeSource("Processor.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        // Locate run(String) unit — same-file symbols have hash-based IDs
        CodeUnit runString = result.units().stream()
                .filter(u -> u.qualifiedName().equals("com.example.Processor#run(String)"))
                .findFirst().orElse(null);
        assertNotNull(runString, "Should have run(String) CodeUnit");

        CodeUnit caller = findUnitBySimpleName(result.units(), "caller");
        assertNotNull(caller);

        boolean callsRunString = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS && e.sourceId().equals(caller.id()))
                .anyMatch(e -> e.targetId().equals(runString.id()));
        assertTrue(callsRunString, "Should disambiguate to run(String) overload when called with 1 argument");
    }

    @Test
    void parse_sameArityOverloads_disambiguatesByLiteralType() throws Exception {
        String source = """
                package com.example;

                public class Dispatcher {
                    public void caller() {
                        run("text");
                        run(42);
                    }

                    public void run(String value) {}
                    public void run(int value) {}
                }
                """;
        Path file = writeSource("Dispatcher.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit runString = result.units().stream()
                .filter(unit -> unit.qualifiedName().equals("com.example.Dispatcher#run(String)"))
                .findFirst().orElseThrow();
        CodeUnit runInt = result.units().stream()
                .filter(unit -> unit.qualifiedName().equals("com.example.Dispatcher#run(int)"))
                .findFirst().orElseThrow();
        CodeUnit caller = findUnitBySimpleName(result.units(), "caller");

        List<RelationEdge> calls = result.edges().stream()
                .filter(edge -> edge.kind() == EdgeKind.CALLS)
                .filter(edge -> edge.sourceId().equals(caller.id()))
                .toList();
        assertTrue(calls.stream().anyMatch(edge -> edge.targetId().equals(runString.id())),
                "String literal should bind run(String)");
        assertTrue(calls.stream().anyMatch(edge -> edge.targetId().equals(runInt.id())),
                "Integer literal should bind run(int)");
    }

    @Test
    void parse_sameArityOverloads_disambiguatesByDeclaredVariableType() throws Exception {
        String source = """
                package com.example;

                public class Dispatcher {
                    public void caller(String text, int count) {
                        run(text);
                        run(count);
                    }

                    public void run(String value) {}
                    public void run(int value) {}
                }
                """;
        Path file = writeSource("Dispatcher.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit runString = result.units().stream()
                .filter(unit -> unit.qualifiedName().equals("com.example.Dispatcher#run(String)"))
                .findFirst().orElseThrow();
        CodeUnit runInt = result.units().stream()
                .filter(unit -> unit.qualifiedName().equals("com.example.Dispatcher#run(int)"))
                .findFirst().orElseThrow();
        CodeUnit caller = findUnitBySimpleName(result.units(), "caller");

        List<RelationEdge> calls = result.edges().stream()
                .filter(edge -> edge.kind() == EdgeKind.CALLS)
                .filter(edge -> edge.sourceId().equals(caller.id()))
                .toList();
        assertTrue(calls.stream().anyMatch(edge -> edge.targetId().equals(runString.id())));
        assertTrue(calls.stream().anyMatch(edge -> edge.targetId().equals(runInt.id())));
    }

    // ── Variable type inference for cross-file CALLS ──────────────────────────

    @Test
    void parse_fieldVariableCall_resolvesToDeclaredType() throws Exception {
        // Simulates Spring injection: private final FooService fooService;
        // A call to fooService.doWork() should produce targetId starting with FooService's FQN
        String source = """
                package com.example;
                import com.other.FooService;
                public class Controller {
                    private final FooService fooService;
                    public Controller(FooService fooService) {
                        this.fooService = fooService;
                    }
                    public void handle() {
                        fooService.doWork();
                    }
                }
                """;
        Path file = writeSource("Controller.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        // CALLS edge target should use FooService's FQN, not "com.example.fooService#doWork"
        boolean hasCorrectTarget = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS)
                .anyMatch(e -> e.targetId().contains("com.other.FooService#doWork")
                           || e.targetId().startsWith("com.other.FooService"));
        assertTrue(hasCorrectTarget,
                "Field variable call should resolve to declared type FQN, not package+varName");

        boolean hasWrongTarget = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS)
                .anyMatch(e -> e.targetId().contains("com.example.fooService"));
        assertFalse(hasWrongTarget,
                "Should NOT produce 'com.example.fooService#doWork' (variable name treated as class)");
    }

    @Test
    void parse_parameterVariableCall_resolvesToDeclaredType() throws Exception {
        String source = """
                package com.example;
                import com.other.Parser;
                public class Service {
                    public void process(Parser parser) {
                        parser.parse("input");
                    }
                }
                """;
        Path file = writeSource("Service.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasCorrectTarget = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS)
                .anyMatch(e -> e.targetId().contains("com.other.Parser#parse")
                           || e.targetId().startsWith("com.other.Parser"));
        assertTrue(hasCorrectTarget,
                "Parameter variable call should resolve to declared type FQN");

        boolean hasWrongTarget = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS)
                .anyMatch(e -> e.targetId().contains("com.example.parser"));
        assertFalse(hasWrongTarget,
                "Should NOT produce 'com.example.parser#parse'");
    }

    @Test
    void parse_crossFileCall_preservesKnownArgumentTypesForOverloadResolution() throws Exception {
        String source = """
                package com.example;
                import com.other.Parser;
                public class Service {
                    public void process(Parser parser) {
                        parser.parse("input");
                    }
                }
                """;
        Path file = writeSource("Service.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        RelationEdge call = result.edges().stream()
                .filter(edge -> edge.kind() == EdgeKind.CALLS)
                .filter(edge -> edge.targetId().contains("com.other.Parser#parse"))
                .findFirst().orElseThrow();

        assertEquals("com.other.Parser#parse(String)", call.targetId());
        assertFalse(call.resolved());
    }

    @Test
    void parse_samePackageStaticCall_resolvesToOwnerTypeNotCaller() throws Exception {
        // Same-package classes need no import (e.g. CowController -> Cowsay in vulnado).
        // Regression test: Cowsay.run(input) must resolve against Cowsay, not be
        // misattributed to the caller's own class (com.example.Controller#run).
        String source = """
                package com.example;
                public class Controller {
                    String cowsay(String input) {
                        return Cowsay.run(input);
                    }
                }
                """;
        Path file = writeSource("Controller.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        RelationEdge call = result.edges().stream()
                .filter(edge -> edge.kind() == EdgeKind.CALLS)
                .filter(edge -> edge.targetId().contains("run"))
                .findFirst().orElseThrow();

        assertEquals("com.example.Cowsay#run(String)", call.targetId(),
                "Same-package static call should resolve against the callee's type, not the caller's own class");
    }

    @Test
    void parse_localVariableCall_resolvesToDeclaredType() throws Exception {
        String source = """
                package com.example;
                import com.other.Builder;
                public class Factory {
                    public Object create() {
                        Builder builder = new Builder();
                        builder.setName("test");
                        return builder.build();
                    }
                }
                """;
        Path file = writeSource("Factory.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasCorrectTarget = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS)
                .anyMatch(e -> e.targetId().contains("com.other.Builder#setName")
                           || e.targetId().startsWith("com.other.Builder"));
        assertTrue(hasCorrectTarget,
                "Local variable call should resolve to declared type FQN");
    }

    @Test
    void parse_chainedCall_sameFile_resolvesToReturnType() throws Exception {
        String source = """
                package com.example;
                public class Factory {
                    public Builder getBuilder() { return new Builder(); }

                    public static class Builder {
                        public Builder setName(String name) { return this; }
                        public Object build() { return null; }
                    }

                    public Object create() {
                        return getBuilder().setName("test").build();
                    }
                }
                """;
        Path file = writeSource("Factory.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit create = findUnitBySimpleName(result.units(), "create");
        assertNotNull(create);

        // getBuilder() returns Builder → setName should target Factory$Builder#setName
        CodeUnit setNameMethod = result.units().stream()
                .filter(u -> u.qualifiedName().contains("Builder#setName"))
                .findFirst().orElse(null);
        assertNotNull(setNameMethod, "Should find Builder#setName CodeUnit");

        boolean callsSetName = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS && e.sourceId().equals(create.id()))
                .anyMatch(e -> e.targetId().equals(setNameMethod.id()));
        assertTrue(callsSetName,
                "create() should CALLS Builder#setName via chained call: getBuilder().setName(...)");
    }

    @Test
    void parse_chainedCall_usesReturnTypeWhenSameNameExistsOnAnotherType() throws Exception {
        String source = """
                package com.example;

                public class Factory {
                    public Builder getBuilder() { return new Builder(); }

                    public static class Builder {
                        public Builder setName(String name) { return this; }
                    }

                    public static class OtherBuilder {
                        public OtherBuilder setName(String name) { return this; }
                    }

                    public Object create() {
                        return getBuilder().setName("test");
                    }
                }
                """;
        Path file = writeSource("Factory.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit create = findUnitBySimpleName(result.units(), "create");
        CodeUnit builderSetName = result.units().stream()
                .filter(unit -> unit.qualifiedName()
                        .equals("com.example.Factory$Builder#setName(String)"))
                .findFirst().orElseThrow();
        CodeUnit otherSetName = result.units().stream()
                .filter(unit -> unit.qualifiedName()
                        .equals("com.example.Factory$OtherBuilder#setName(String)"))
                .findFirst().orElseThrow();

        List<RelationEdge> calls = result.edges().stream()
                .filter(edge -> edge.kind() == EdgeKind.CALLS)
                .filter(edge -> edge.sourceId().equals(create.id()))
                .toList();
        assertTrue(calls.stream().anyMatch(edge -> edge.targetId().equals(builderSetName.id())));
        assertFalse(calls.stream().anyMatch(edge -> edge.targetId().equals(otherSetName.id())));
    }

    @Test
    void parse_inheritedCall_usesDeclaredSuperTypeWhenSameMethodExistsElsewhere() throws Exception {
        String source = """
                package com.example;

                class BaseA {
                    protected void work(String value) {}
                }

                class BaseB {
                    protected void work(String value) {}
                }

                class Child extends BaseA {
                    void run() {
                        work("value");
                    }
                }
                """;
        Path file = writeSource("Child.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        CodeUnit run = result.units().stream()
                .filter(unit -> unit.qualifiedName().equals("com.example.Child#run()"))
                .findFirst().orElseThrow();
        CodeUnit baseAWork = result.units().stream()
                .filter(unit -> unit.qualifiedName().equals("com.example.BaseA#work(String)"))
                .findFirst().orElseThrow();
        CodeUnit baseBWork = result.units().stream()
                .filter(unit -> unit.qualifiedName().equals("com.example.BaseB#work(String)"))
                .findFirst().orElseThrow();

        List<RelationEdge> calls = result.edges().stream()
                .filter(edge -> edge.kind() == EdgeKind.CALLS)
                .filter(edge -> edge.sourceId().equals(run.id()))
                .toList();
        assertTrue(calls.stream().anyMatch(edge -> edge.targetId().equals(baseAWork.id())));
        assertFalse(calls.stream().anyMatch(edge -> edge.targetId().equals(baseBWork.id())));
    }

    @Test
    void parse_thisFieldMethodCall_resolvesViaFieldType() throws Exception {
        // this.repo.findAll() — scope is FieldAccessExpr(this, "repo")
        String source = """
                package com.example;
                import com.other.UserRepo;
                public class Service {
                    private final UserRepo repo;
                    public void load() {
                        this.repo.findAll();
                    }
                }
                """;
        Path file = writeSource("Service.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        boolean hasCorrectTarget = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS && e.targetId().contains("findAll"))
                .anyMatch(e -> e.targetId().startsWith("com.other.UserRepo"));
        assertTrue(hasCorrectTarget,
                "this.repo.findAll() should resolve repo to its declared type UserRepo");

        boolean hasWrongTarget = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS && e.targetId().contains("findAll"))
                .anyMatch(e -> e.targetId().contains("com.example.repo"));
        assertFalse(hasWrongTarget,
                "Should NOT produce 'com.example.repo#findAll' (field access via this)");
    }

    @Test
    void parse_thisConstructorDelegation_producesCallsEdge() throws Exception {
        String source = """
                package com.example;
                public class Service {
                    private final String name;
                    private final int port;

                    public Service(String name) {
                        this(name, 8080);
                    }

                    public Service(String name, int port) {
                        this.name = name;
                        this.port = port;
                    }
                }
                """;
        Path file = writeSource("Service.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        // Find both constructors
        CodeUnit ctorOne = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.CONSTRUCTOR
                          && u.qualifiedName().equals("com.example.Service#Service(String)"))
                .findFirst().orElse(null);
        CodeUnit ctorTwo = result.units().stream()
                .filter(u -> u.kind() == CodeUnitKind.CONSTRUCTOR
                          && u.qualifiedName().equals("com.example.Service#Service(String,int)"))
                .findFirst().orElse(null);

        assertNotNull(ctorOne, "Should find Service(String) constructor");
        assertNotNull(ctorTwo, "Should find Service(String,int) constructor");

        boolean delegatesCall = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS && e.sourceId().equals(ctorOne.id()))
                .anyMatch(e -> e.targetId().equals(ctorTwo.id()));
        assertTrue(delegatesCall,
                "Service(String) should CALLS Service(String,int) via this(name, 8080)");
    }

    @Test
    void parse_localVarShadowsField_fieldStillResolvesCorrectly() throws Exception {
        // Method A shadows field "repo" with a local var of a different type.
        // Method B uses the field "repo" — must still resolve to the field's declared type.
        String source = """
                package com.example;
                import com.other.FooRepo;
                import com.other.BarRepo;
                public class Service {
                    private final FooRepo repo;
                    public void methodA() {
                        BarRepo repo = new BarRepo();
                        repo.barOp();
                    }
                    public void methodB() {
                        repo.fooOp();
                    }
                }
                """;
        Path file = writeSource("Service.java", source);
        ParseResult result = parser.parse(file, ParseOptions.defaults());

        // methodB's repo.fooOp() must resolve to FooRepo (field type), not BarRepo
        boolean hasCorrectTarget = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS && e.targetId().contains("fooOp"))
                .anyMatch(e -> e.targetId().startsWith("com.other.FooRepo"));
        assertTrue(hasCorrectTarget,
                "Field call in methodB must resolve to field's declared type FooRepo, not methodA's local BarRepo");

        boolean hasWrongTarget = result.edges().stream()
                .filter(e -> e.kind() == EdgeKind.CALLS && e.targetId().contains("fooOp"))
                .anyMatch(e -> e.targetId().startsWith("com.other.BarRepo"));
        assertFalse(hasWrongTarget,
                "Should NOT resolve field call to BarRepo (stale local var from methodA)");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Path writeSource(String fileName, String content) throws IOException {
        Path file = tempDir.resolve(fileName);
        Files.writeString(file, content);
        return file;
    }

    private CodeUnit findUnit(List<CodeUnit> units, CodeUnitKind kind) {
        return units.stream().filter(u -> u.kind() == kind).findFirst().orElse(null);
    }

    private CodeUnit findUnitBySimpleName(List<CodeUnit> units, String simpleName) {
        return units.stream().filter(u -> u.simpleName().equals(simpleName)).findFirst().orElse(null);
    }
}
