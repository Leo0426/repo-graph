package com.repograph.retrieval;

import com.repograph.core.graph.ClassEdge;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.retrieval.KeywordSearchOptions;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link SimpleKeywordSearchService} 行为测试。
 *
 * @author leolu
 */
class SimpleKeywordSearchServiceTest {

    @Test
    void search_ranksIdentifierAndCweMatches() {
        CodeUnit exec = unit("com.example.CommandController#run()", "Runtime.exec(userInput); // CWE-78");
        CodeUnit helper = unit("com.example.Helper#format()", "return value.trim();");
        SimpleKeywordSearchService service = new SimpleKeywordSearchService(
                new StubDiagnostics(List.of(helper, exec)));

        var results = service.search("CWE-78 Runtime.exec",
                new KeywordSearchOptions(10, "java", CodeUnitKind.METHOD, "project-a", true));

        assertThat(results).hasSize(1);
        assertThat(results.getFirst().unit().qualifiedName()).isEqualTo(exec.qualifiedName());
        assertThat(results.getFirst().matchedTerms()).contains("cwe-78", "runtime.exec");
    }

    private static CodeUnit unit(String qn, String rawSource) {
        String simpleName = qn.substring(qn.indexOf('#') + 1, qn.indexOf('('));
        return new CodeUnit(qn, CodeUnitKind.METHOD, "java", qn, simpleName,
                "src/main/java/Example.java", 1, 5, rawSource,
                "void " + simpleName + "()", List.of(), "com.example.Example", Map.of());
    }

    private record StubDiagnostics(List<CodeUnit> units) implements GraphDiagnosticsService {
        @Override public List<CodeUnit> listScanTargets(String projectId) { return units; }
        @Override public List<CodeUnit> listSearchTargets(String projectId, String language,
                CodeUnitKind kind, boolean noTest, int limit) { return units; }
        @Override public List<ClassEdge> findClassCallEdges(String projectId) { return List.of(); }
        @Override public List<CodeUnit> findDeadCode(String projectId) { return List.of(); }
        @Override public List<CodeUnit> findTestGaps(String projectId) { return List.of(); }
    }
}
