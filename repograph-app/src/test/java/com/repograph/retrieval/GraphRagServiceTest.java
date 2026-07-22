package com.repograph.retrieval;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import com.repograph.core.graph.ProjectStats;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.retrieval.GraphRagOptions;
import com.repograph.core.retrieval.KeywordSearchResult;
import com.repograph.core.retrieval.KeywordSearchService;
import com.repograph.core.vector.EmbeddedUnit;
import com.repograph.core.vector.SearchOptions;
import com.repograph.core.vector.SearchPage;
import com.repograph.core.vector.SearchResult;
import com.repograph.core.vector.VectorStore;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link GraphRagService} 行为测试。
 *
 * @author leolu
 */
class GraphRagServiceTest {

    @Test
    void search_expandsCallGraphWithinRequestedProjectAndDeduplicatesResults() {
        CodeUnit seed = unit("seed", "com.example.Controller#handle()", Map.of("is_entry_point", "true"));
        CodeUnit caller = unit("caller", "com.example.Router#route()", Map.of());
        CodeUnit callee = unit("callee", "com.example.Service#execute()", Map.of());
        RecordingVectorStore vectorStore = new RecordingVectorStore(
                new SearchPage(List.of(new SearchResult(seed, 0.9f)), 0, 10, false));
        RecordingGraphQueryService graph = new RecordingGraphQueryService();
        graph.callers = List.of(caller, seed);
        graph.callees = List.of(callee, caller);
        GraphRagService service = new GraphRagService(
                vectorStore, graph, new SecurityAwareReranker());

        var result = service.search("request flow",
                new GraphRagOptions(10, 2, true, false, true,
                        "project-a", "java", true));

        assertThat(vectorStore.options.projectId()).isEqualTo("project-a");
        assertThat(graph.requestedProjectIds).containsOnly("project-a");
        assertThat(result.results())
                .extracting(ranked -> ranked.unit().qualifiedName())
                .containsExactlyInAnyOrder(
                        "com.example.Controller#handle()",
                        "com.example.Router#route()",
                        "com.example.Service#execute()");
        assertThat(result.callGraphExpanded()).isEqualTo(2);
    }

    @Test
    void search_impactExpansionAddsOnlySecurityRelevantNodes() {
        CodeUnit seed = unit("seed", "com.example.Service#save()", Map.of());
        CodeUnit sensitive = unit("sensitive", "com.example.Auth#validateToken()",
                Map.of("is_entry_point", "true"));
        CodeUnit ordinary = unit("ordinary", "com.example.Helper#format()", Map.of());
        RecordingVectorStore vectorStore = new RecordingVectorStore(
                new SearchPage(List.of(new SearchResult(seed, 0.8f)), 0, 10, false));
        RecordingGraphQueryService graph = new RecordingGraphQueryService();
        graph.impact = Set.of(sensitive, ordinary);
        GraphRagService service = new GraphRagService(
                vectorStore, graph, new SecurityAwareReranker());

        var result = service.search("authentication",
                new GraphRagOptions(10, 1, false, true, true,
                        "project-a", "java", true));

        assertThat(result.impactExpanded()).isEqualTo(1);
        assertThat(result.results())
                .extracting(ranked -> ranked.source())
                .contains("IMPACT")
                .doesNotContain("DATA_FLOW");
        assertThat(result.results())
                .extracting(ranked -> ranked.unit().qualifiedName())
                .contains(sensitive.qualifiedName())
                .doesNotContain(ordinary.qualifiedName());
    }

    @Test
    void search_rerankDisabledDoesNotApplySecurityBonus() {
        CodeUnit sensitive = unit("sensitive", "com.example.Auth#validateToken()",
                Map.of("is_entry_point", "true"));
        RecordingVectorStore vectorStore = new RecordingVectorStore(
                new SearchPage(List.of(new SearchResult(sensitive, 0.7f)), 0, 10, false));
        GraphRagService service = new GraphRagService(
                vectorStore, new RecordingGraphQueryService(), new SecurityAwareReranker());

        var result = service.search("authentication",
                new GraphRagOptions(10, 1, false, false, false,
                        "project-a", "java", true));

        assertThat(result.results()).singleElement().satisfies(ranked -> {
            assertThat(ranked.securityScore()).isGreaterThan(0f);
            assertThat(ranked.finalScore()).isEqualTo(0.7f);
        });
    }

    @Test
    void search_mergesKeywordSeedsWithVectorSeeds() {
        CodeUnit vectorSeed = unit("seed", "com.example.Auth#login()", Map.of());
        CodeUnit keywordSeed = unit("keyword", "com.example.Command#exec()", Map.of());
        RecordingVectorStore vectorStore = new RecordingVectorStore(
                new SearchPage(List.of(new SearchResult(vectorSeed, 0.7f)), 0, 10, false));
        KeywordSearchService keyword = (query, options) -> List.of(
                new KeywordSearchResult(keywordSeed, 0.8f, List.of("cwe-78", "exec")));
        GraphRagService service = new GraphRagService(
                vectorStore, new RecordingGraphQueryService(), new SecurityAwareReranker(), keyword);

        var result = service.search("CWE-78 exec",
                new GraphRagOptions(10, 1, false, false, true,
                        "project-a", "java", true));

        assertThat(result.keywordSeedCount()).isEqualTo(1);
        assertThat(result.results())
                .extracting(ranked -> ranked.source())
                .contains("VECTOR", "KEYWORD");
        assertThat(result.results())
                .filteredOn(ranked -> ranked.source().equals("KEYWORD"))
                .singleElement()
                .satisfies(ranked -> assertThat(ranked.securitySignals()).contains("keyword:cwe-78", "keyword:exec"));
    }

    private static CodeUnit unit(String id, String qualifiedName, Map<String, String> metadata) {
        String simpleName = qualifiedName.substring(
                qualifiedName.indexOf('#') + 1, qualifiedName.indexOf('('));
        return new CodeUnit(id, CodeUnitKind.METHOD, "java", qualifiedName, simpleName,
                "src/main/java/Example.java", 1, 5, "void " + simpleName + "() {}",
                "void " + simpleName + "()", List.of(), "com.example.Example", metadata);
    }

    private static final class RecordingVectorStore implements VectorStore {

        private final SearchPage page;
        private SearchOptions options;

        private RecordingVectorStore(SearchPage page) {
            this.page = page;
        }

        @Override
        public void upsert(List<EmbeddedUnit> units, String projectId) {
        }

        @Override
        public SearchPage semanticSearch(String nlQuery, SearchOptions opts) {
            options = opts;
            return page;
        }

        @Override
        public SearchPage codeSearch(String codeSnippet, SearchOptions opts) {
            return page;
        }

        @Override
        public void removeByFile(String filePath, String projectId) {
        }

        @Override
        public void removeByProject(String projectId) {
        }

        @Override
        public Optional<CodeUnit> symbolLookup(String qualifiedName) {
            return Optional.empty();
        }

        @Override
        public Optional<CodeUnit> locateByPosition(String filePath, int line) {
            return Optional.empty();
        }
    }

    private static final class RecordingGraphQueryService implements GraphQueryService {

        private List<CodeUnit> callers = List.of();
        private List<CodeUnit> callees = List.of();
        private Set<CodeUnit> impact = Set.of();
        private final List<String> requestedProjectIds = new ArrayList<>();

        @Override
        public List<CodeUnit> findCallers(String qualifiedName, int depth, String projectId) {
            requestedProjectIds.add(projectId);
            return callers;
        }

        @Override
        public Set<CodeUnit> impactAnalysis(String qualifiedName, String projectId) {
            requestedProjectIds.add(projectId);
            return impact;
        }

        @Override
        public List<CodeUnit> findCallees(String qualifiedName, int depth, String projectId) {
            requestedProjectIds.add(projectId);
            return callees;
        }

        @Override
        public List<CodeUnit> findSubTypes(String qualifiedName, String projectId) {
            return List.of();
        }

        @Override
        public List<CodeUnit> findSymbols(String query, String projectId, int limit) {
            return List.of();
        }

        @Override
        public Optional<CodeUnit> findSymbol(String qualifiedName, String projectId) {
            return Optional.empty();
        }

        @Override
        public List<CodeUnit> findEntryPoints(String projectId) {
            return List.of();
        }

        @Override
        public List<ProjectInfo> listProjects() {
            return List.of();
        }

        @Override
        public ProjectStats projectStats(String projectId) {
            throw new UnsupportedOperationException();
        }

    }
}
