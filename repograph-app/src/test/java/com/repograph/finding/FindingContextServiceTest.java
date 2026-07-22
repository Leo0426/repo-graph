package com.repograph.finding;

import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.FindingContext;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.retrieval.KeywordSearchOptions;
import com.repograph.core.retrieval.KeywordSearchResult;
import com.repograph.core.retrieval.KeywordSearchService;
import com.repograph.core.vector.VectorStore;
import com.repograph.retrieval.ContextPackService;
import com.repograph.retrieval.GraphRagService;
import com.repograph.retrieval.SecurityAwareReranker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@link FindingContextService} 行为测试。
 *
 * @author leolu
 */
class FindingContextServiceTest {

    private VectorStore vectorStore;
    private GraphQueryService graphQueryService;
    private KeywordSearchService keywordSearchService;
    private SecurityAwareReranker reranker;
    private FindingContextService service;

    @BeforeEach
    void setUp() {
        vectorStore = mock(VectorStore.class);
        graphQueryService = mock(GraphQueryService.class);
        keywordSearchService = mock(KeywordSearchService.class);
        reranker = mock(SecurityAwareReranker.class);
        when(reranker.analyze(any())).thenReturn(
                new SecurityAwareReranker.SecurityAnalysis(0f, List.of()));
        service = new FindingContextService(vectorStore, graphQueryService,
                keywordSearchService, reranker,
                new ContextPackService(mock(GraphRagService.class)));
    }

    @Test
    void build_locatesFindingAndExpandsCallGraphAndKeyword() {
        CodeUnit located = unit("com.example.OrderService#run()",
                "src/main/java/com/example/OrderService.java");
        CodeUnit caller = unit("com.example.OrderController#submit()",
                "src/main/java/com/example/OrderController.java");
        CodeUnit keywordHit = unit("com.example.CommandUtil#exec()",
                "src/main/java/com/example/CommandUtil.java");

        when(vectorStore.locateByPosition("src/main/java/com/example/OrderService.java", 42))
                .thenReturn(Optional.of(located));
        when(graphQueryService.findCallers(eq(located.qualifiedName()), anyInt(), any()))
                .thenReturn(List.of(caller));
        when(graphQueryService.findCallees(eq(located.qualifiedName()), anyInt(), any()))
                .thenReturn(List.of());
        when(keywordSearchService.search(anyString(), any(KeywordSearchOptions.class)))
                .thenReturn(List.of(new KeywordSearchResult(keywordHit, 0.8f, List.of("CWE-78"))));

        FindingContext context = service.build(finding(42), null);

        assertThat(context.located()).isTrue();
        assertThat(context.locatedQualifiedName()).isEqualTo(located.qualifiedName());
        assertThat(context.pack().evidence()).hasSize(3);
        assertThat(context.pack().evidence().get(0)).satisfies(e -> {
            assertThat(e.citationId()).isEqualTo("C1");
            assertThat(e.source()).isEqualTo("FINDING");
            assertThat(e.qualifiedName()).isEqualTo(located.qualifiedName());
        });
        assertThat(context.pack().evidence().get(1).relation()).isEqualTo("CALLER");
        assertThat(context.pack().evidence().get(2)).satisfies(e -> {
            assertThat(e.source()).isEqualTo("KEYWORD");
            assertThat(e.securitySignals()).contains("keyword:CWE-78");
        });
        assertThat(context.pack().seedCount()).isEqualTo(1);
        assertThat(context.pack().keywordSeedCount()).isEqualTo(1);
        assertThat(context.pack().callGraphExpanded()).isEqualTo(1);
    }

    @Test
    void build_reportsMissingReasonWhenLocationNotIndexed() {
        CodeUnit keywordHit = unit("com.example.CommandUtil#exec()",
                "src/main/java/com/example/CommandUtil.java");
        when(vectorStore.locateByPosition(anyString(), anyInt())).thenReturn(Optional.empty());
        when(keywordSearchService.search(anyString(), any(KeywordSearchOptions.class)))
                .thenReturn(List.of(new KeywordSearchResult(keywordHit, 0.8f, List.of("exec"))));

        FindingContext context = service.build(finding(999), null);

        assertThat(context.located()).isFalse();
        assertThat(context.locatedQualifiedName()).isEmpty();
        assertThat(context.pack().omittedReasons())
                .anyMatch(reason -> reason.contains("not indexed")
                        && reason.contains("OrderService.java:999"));
        assertThat(context.pack().evidence()).singleElement()
                .satisfies(e -> assertThat(e.source()).isEqualTo("KEYWORD"));
        assertThat(context.pack().seedCount()).isZero();
    }

    @Test
    void build_deduplicatesKeywordHitAgainstLocatedUnit() {
        CodeUnit located = unit("com.example.OrderService#run()",
                "src/main/java/com/example/OrderService.java");
        when(vectorStore.locateByPosition(anyString(), anyInt())).thenReturn(Optional.of(located));
        when(keywordSearchService.search(anyString(), any(KeywordSearchOptions.class)))
                .thenReturn(List.of(new KeywordSearchResult(located, 0.9f, List.of("run"))));

        FindingContext context = service.build(finding(42), null);

        assertThat(context.pack().evidence()).singleElement()
                .satisfies(e -> assertThat(e.source()).isEqualTo("FINDING"));
        assertThat(context.pack().keywordSeedCount()).isZero();
    }

    @Test
    void build_fieldLocation_markedReachableWhenEnclosingClassHostsEntryPoint() {
        // Hardcoded secrets / weak-random seeds are commonly flagged on FIELD units, which
        // never participate in CALLS edges and so can never accumulate CALLER evidence.
        // If the enclosing class hosts a framework entry point (e.g. a @PostMapping handler
        // reading this field), treat the field as reachable too.
        CodeUnit field = new CodeUnit("com.example.JwtUtils#SECRET", CodeUnitKind.FIELD, "java",
                "com.example.JwtUtils#SECRET", "SECRET", "src/main/java/com/example/JwtUtils.java",
                10, 10, "public static final String SECRET = \"hardcoded\";", "String SECRET",
                List.of(), "com.example.JwtUtils", Map.of());
        CodeUnit entryMethod = new CodeUnit("com.example.JwtUtils#createToken()", CodeUnitKind.METHOD, "java",
                "com.example.JwtUtils#createToken()", "createToken", "src/main/java/com/example/JwtUtils.java",
                20, 30, "...", "String createToken()", List.of("@PostMapping"),
                "com.example.JwtUtils", Map.of("is_entry_point", "true"));

        when(vectorStore.locateByPosition("src/main/java/com/example/JwtUtils.java", 10))
                .thenReturn(Optional.of(field));
        when(graphQueryService.findEntryPoints(any())).thenReturn(List.of(entryMethod));
        when(keywordSearchService.search(anyString(), any(KeywordSearchOptions.class)))
                .thenReturn(List.of());

        FindingContext context = service.build(fieldFinding(), null);

        assertThat(context.pack().evidence()).singleElement()
                .satisfies(e -> assertThat(e.securitySignals()).contains("entry_point"));
    }

    @Test
    void build_fieldLocation_notMarkedReachableWhenNoEntryPointInEnclosingClass() {
        CodeUnit field = new CodeUnit("com.example.Util#SECRET", CodeUnitKind.FIELD, "java",
                "com.example.Util#SECRET", "SECRET", "src/main/java/com/example/JwtUtils.java",
                10, 10, "public static final String SECRET = \"hardcoded\";", "String SECRET",
                List.of(), "com.example.Util", Map.of());
        CodeUnit unrelatedEntryMethod = new CodeUnit("com.example.OtherController#handle()", CodeUnitKind.METHOD,
                "java", "com.example.OtherController#handle()", "handle", "src/main/java/com/example/Other.java",
                20, 30, "...", "void handle()", List.of("@GetMapping"),
                "com.example.OtherController", Map.of("is_entry_point", "true"));

        when(vectorStore.locateByPosition("src/main/java/com/example/JwtUtils.java", 10))
                .thenReturn(Optional.of(field));
        when(graphQueryService.findEntryPoints(any())).thenReturn(List.of(unrelatedEntryMethod));
        when(keywordSearchService.search(anyString(), any(KeywordSearchOptions.class)))
                .thenReturn(List.of());

        FindingContext context = service.build(fieldFinding(), null);

        assertThat(context.pack().evidence()).singleElement()
                .satisfies(e -> assertThat(e.securitySignals()).doesNotContain("entry_point"));
    }

    private static ExternalFinding fieldFinding() {
        return new ExternalFinding("semgrep", "java.java-jwt.security.jwt-hardcode",
                "CWE-798", ExternalFindingSeverity.HIGH,
                "Hardcoded JWT secret",
                "src/main/java/com/example/JwtUtils.java", 10, 10,
                "SECRET", List.of(), "{}");
    }

    private static ExternalFinding finding(int line) {
        return new ExternalFinding("semgrep", "java.lang.security.audit.command-injection",
                "CWE-78", ExternalFindingSeverity.HIGH,
                "Detected command injection via Runtime.exec",
                "src/main/java/com/example/OrderService.java", line, line,
                "run", List.of(), "{}");
    }

    private static CodeUnit unit(String qualifiedName, String filePath) {
        return new CodeUnit(qualifiedName, CodeUnitKind.METHOD, "java",
                qualifiedName, qualifiedName.substring(qualifiedName.indexOf('#') + 1),
                filePath, 40, 60, "void run() { Runtime.getRuntime().exec(cmd); }",
                "void run()", List.of(), qualifiedName.substring(0, qualifiedName.indexOf('#')),
                Map.of());
    }
}
