package com.repograph.parser;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.parser.CodeParser;
import com.repograph.core.parser.ParseException;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import com.repograph.core.parser.ParseStrategy;
import com.repograph.parser.heuristic.HeuristicCodeParser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link ParserDispatcher} 单元测试，验证 PRECISE/HEURISTIC/AUTO 策略路由和降级逻辑。
 *
 * @author leolu
 * @since 0.1.0
 */
class ParserDispatcherTest {

    @TempDir
    Path tempDir;

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static CodeUnit dummyUnit(String qn) {
        return new CodeUnit("id", CodeUnitKind.FUNCTION, "c",
                qn, qn, "f.c", 1, 5, "", qn, List.of(), null, Map.of());
    }

    /** Minimal CodeParser stub that supports one language and returns a fixed result. */
    private static CodeParser stubParser(String language, ParseResult result) {
        return new CodeParser() {
            @Override public boolean supports(String lang) { return language.equals(lang); }
            @Override public ParseResult parse(Path file, ParseOptions opts) { return result; }
        };
    }

    /** Stub that throws ParseException when parse() is called. */
    private static CodeParser failingParser(String language) {
        return new CodeParser() {
            @Override public boolean supports(String lang) { return language.equals(lang); }
            @Override public ParseResult parse(Path file, ParseOptions opts) throws ParseException {
                throw new ParseException("deliberate failure");
            }
        };
    }

    /** Minimal HeuristicCodeParser subclass that returns a fixed result without reading the file. */
    private static HeuristicCodeParser heuristicStub(String language, ParseResult result) {
        return new HeuristicCodeParser() {
            @Override public boolean supports(String lang) { return language.equals(lang); }
            @Override public ParseResult parse(Path file, ParseOptions opts) { return result; }
        };
    }

    private Path javaFile() throws IOException {
        return Files.createTempFile(tempDir, "Foo", ".java");
    }

    private Path cFile() throws IOException {
        return Files.createTempFile(tempDir, "foo", ".c");
    }

    private Path unknownFile() throws IOException {
        return Files.createTempFile(tempDir, "data", ".csv");
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    @Test
    void dispatch_unsupportedExtension_returnsEmpty() throws IOException {
        ParserDispatcher dispatcher = new ParserDispatcher(List.of());
        ParseResult result = dispatcher.dispatch(unknownFile(), null);
        assertThat(result.units()).isEmpty();
        assertThat(result.edges()).isEmpty();
        assertThat(result.degraded()).isFalse();
    }

    @Test
    void dispatch_noParserForLanguage_returnsEmpty() throws IOException {
        ParserDispatcher dispatcher = new ParserDispatcher(List.of());
        ParseResult result = dispatcher.dispatch(javaFile(), null);
        assertThat(result.units()).isEmpty();
        assertThat(result.degraded()).isFalse();
    }

    @Test
    void dispatch_preciseStrategy_usesPreciseParser() throws IOException {
        ParseResult expected = ParseResult.of(List.of(dummyUnit("foo")), List.of(), "StubParser");
        CodeParser precise = stubParser("java", expected);
        ParserDispatcher dispatcher = new ParserDispatcher(List.of(precise));

        ParseOptions opts = new ParseOptions(ParseStrategy.PRECISE, List.of(), null);
        ParseResult result = dispatcher.dispatch(javaFile(), opts);

        assertThat(result.units()).hasSize(1);
        assertThat(result.units().get(0).qualifiedName()).isEqualTo("foo");
        assertThat(result.degraded()).isFalse();
    }

    @Test
    void dispatch_heuristicStrategy_usesHeuristicParser() throws IOException {
        ParseResult expected = ParseResult.of(List.of(dummyUnit("bar")), List.of(), "HeuristicStub");
        HeuristicCodeParser heuristic = heuristicStub("java", expected);
        ParserDispatcher dispatcher = new ParserDispatcher(List.of(heuristic));

        ParseOptions opts = new ParseOptions(ParseStrategy.HEURISTIC, List.of(), null);
        ParseResult result = dispatcher.dispatch(javaFile(), opts);

        assertThat(result.units()).hasSize(1);
        assertThat(result.units().get(0).qualifiedName()).isEqualTo("bar");
        // HEURISTIC 策略直接调启发式，不经过降级路径，degraded=false
        assertThat(result.degraded()).isFalse();
    }

    @Test
    void dispatch_autoStrategy_preciseSucceeds_nofallback() throws IOException {
        ParseResult preciseResult = ParseResult.of(List.of(dummyUnit("precise_unit")), List.of(), "PreciseStub");
        ParseResult heuristicResult = ParseResult.of(List.of(dummyUnit("heuristic_unit")), List.of(), "HeuristicStub");

        CodeParser precise = stubParser("java", preciseResult);
        HeuristicCodeParser heuristic = heuristicStub("java", heuristicResult);
        ParserDispatcher dispatcher = new ParserDispatcher(List.of(precise, heuristic));

        ParseOptions opts = new ParseOptions(ParseStrategy.AUTO, List.of(), null);
        ParseResult result = dispatcher.dispatch(javaFile(), opts);

        assertThat(result.units()).hasSize(1);
        assertThat(result.units().get(0).qualifiedName()).isEqualTo("precise_unit");
        assertThat(result.parserUsed()).isEqualTo("PreciseStub");
        assertThat(result.degraded()).isFalse();
    }

    @Test
    void dispatch_autoStrategy_preciseFails_fallsBackToHeuristic() throws IOException {
        ParseResult fallbackResult = ParseResult.of(List.of(dummyUnit("heuristic_unit")), List.of(), "HeuristicStub");

        CodeParser failing = failingParser("java");
        HeuristicCodeParser heuristic = heuristicStub("java", fallbackResult);
        ParserDispatcher dispatcher = new ParserDispatcher(List.of(failing, heuristic));

        ParseOptions opts = new ParseOptions(ParseStrategy.AUTO, List.of(), null);
        ParseResult result = dispatcher.dispatch(javaFile(), opts);

        assertThat(result.units()).hasSize(1);
        assertThat(result.units().get(0).qualifiedName()).isEqualTo("heuristic_unit");
        assertThat(result.parserUsed()).isEqualTo("HeuristicStub");
        assertThat(result.degraded()).isTrue();
    }

    @Test
    void dispatch_autoStrategy_preciseReturnsEmpty_fallsBackToHeuristic() throws IOException {
        ParseResult fallbackResult = ParseResult.of(List.of(dummyUnit("fallback")), List.of(), "HeuristicStub");

        CodeParser precise = stubParser("java", ParseResult.empty());
        HeuristicCodeParser heuristic = heuristicStub("java", fallbackResult);
        ParserDispatcher dispatcher = new ParserDispatcher(List.of(precise, heuristic));

        ParseOptions opts = new ParseOptions(ParseStrategy.AUTO, List.of(), null);
        ParseResult result = dispatcher.dispatch(javaFile(), opts);

        assertThat(result.units()).hasSize(1);
        assertThat(result.units().get(0).qualifiedName()).isEqualTo("fallback");
        assertThat(result.parserUsed()).isEqualTo("HeuristicStub");
        assertThat(result.degraded()).isTrue();
    }

    @Test
    void dispatch_nullOptions_defaultsToAutoStrategy() throws IOException {
        ParseResult preciseResult = ParseResult.of(List.of(dummyUnit("u")), List.of(), "StubParser");
        CodeParser precise = stubParser("c", preciseResult);
        ParserDispatcher dispatcher = new ParserDispatcher(List.of(precise));

        ParseResult result = dispatcher.dispatch(cFile(), null);

        assertThat(result.units()).hasSize(1);
        assertThat(result.degraded()).isFalse();
    }

    @Test
    void dispatch_autoStrategy_preciseEmptyAndNoHeuristic_returnsEmpty() throws IOException {
        CodeParser precise = stubParser("java", ParseResult.empty());
        ParserDispatcher dispatcher = new ParserDispatcher(List.of(precise));

        ParseOptions opts = new ParseOptions(ParseStrategy.AUTO, List.of(), null);
        ParseResult result = dispatcher.dispatch(javaFile(), opts);

        assertThat(result.units()).isEmpty();
        assertThat(result.degraded()).isFalse();
    }
}
