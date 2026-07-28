package com.repograph.authorization;

import com.repograph.core.authorization.AuthorizationEvidence;
import com.repograph.core.authorization.AuthorizationEvidenceStatus;
import com.repograph.core.authorization.AuthorizationScope;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Spring 路由、鉴权候选和资源访问证据测试。
 *
 * @author leolu
 */
class SpringAuthorizationEvidenceServiceTest {

    private GraphQueryService graph;
    private GraphDiagnosticsService diagnostics;
    private SpringAuthorizationEvidenceService service;

    @BeforeEach
    void setUp() {
        graph = mock(GraphQueryService.class);
        diagnostics = mock(GraphDiagnosticsService.class);
        service = new SpringAuthorizationEvidenceService(graph, diagnostics);
        when(diagnostics.listScanTargets("project-1")).thenReturn(List.of());
    }

    @Test
    void methodConstraintOverridesClassConstraintAndRouteIsCombined() {
        CodeUnit controller = type(
                "com.example.AdminController",
                List.of("@RequestMapping", "@PreAuthorize"),
                Map.of(
                        "ann_RequestMapping", "/api/admin",
                        "ann_PreAuthorize", "hasRole('ADMIN')"));
        CodeUnit method = method(
                "com.example.AdminController#users()",
                "com.example.AdminController",
                "UserController.java",
                20,
                "return service.findAll();",
                List.of("@GetMapping", "@PreAuthorize"),
                Map.of(
                        "ann_GetMapping", "/users",
                        "ann_PreAuthorize", "hasAuthority('user:read')"));
        when(graph.findEntryPoints("project-1")).thenReturn(List.of(method));
        when(graph.findSymbol(controller.qualifiedName(), "project-1")).thenReturn(Optional.of(controller));
        when(graph.findCallees(method.qualifiedName(), 1, "project-1")).thenReturn(List.of());

        AuthorizationEvidence evidence = service.analyze("project-1", 4).getFirst();

        assertThat(evidence.route().path()).isEqualTo("/api/admin/users");
        assertThat(evidence.route().httpMethods()).containsExactly("GET");
        assertThat(evidence.status()).isEqualTo(AuthorizationEvidenceStatus.LOCAL_CONSTRAINT_CANDIDATE);
        assertThat(evidence.constraints())
                .anySatisfy(constraint -> {
                    assertThat(constraint.scope()).isEqualTo(AuthorizationScope.METHOD);
                    assertThat(constraint.expression()).isEqualTo("hasAuthority('user:read')");
                    assertThat(constraint.effective()).isTrue();
                })
                .anySatisfy(constraint -> {
                    assertThat(constraint.scope()).isEqualTo(AuthorizationScope.CLASS);
                    assertThat(constraint.expression()).isEqualTo("hasRole('ADMIN')");
                    assertThat(constraint.effective()).isFalse();
                });
    }

    @Test
    void classConstraintIsInheritedWhenMethodHasNoConstraint() {
        CodeUnit controller = type(
                "com.example.AdminController",
                List.of("@RequestMapping", "@RolesAllowed"),
                Map.of("ann_RequestMapping", "/admin", "ann_RolesAllowed", "{\"ADMIN\", \"AUDITOR\"}"));
        CodeUnit method = method(
                "com.example.AdminController#audit()",
                controller.qualifiedName(),
                "AdminController.java",
                12,
                "return auditService.list();",
                List.of("@GetMapping"),
                Map.of("ann_GetMapping", "/audit"));
        when(graph.findEntryPoints("project-1")).thenReturn(List.of(method));
        when(graph.findSymbol(controller.qualifiedName(), "project-1")).thenReturn(Optional.of(controller));
        when(graph.findCallees(method.qualifiedName(), 1, "project-1")).thenReturn(List.of());

        AuthorizationEvidence evidence = service.analyze("project-1", 4).getFirst();

        assertThat(evidence.constraints()).singleElement().satisfies(constraint -> {
            assertThat(constraint.scope()).isEqualTo(AuthorizationScope.CLASS);
            assertThat(constraint.expression()).contains("ADMIN", "AUDITOR");
            assertThat(constraint.effective()).isTrue();
        });
    }

    @Test
    void noLocalConstraintIsReportedAsUnknownRatherThanConfirmedUnauthenticated() {
        CodeUnit method = method(
                "com.example.PublicController#health()",
                "com.example.PublicController",
                "PublicController.java",
                8,
                "return \"ok\";",
                List.of("@GetMapping"),
                Map.of("ann_GetMapping", "/health"));
        when(graph.findEntryPoints("project-1")).thenReturn(List.of(method));
        when(graph.findSymbol(method.parentQualifiedName(), "project-1")).thenReturn(Optional.empty());
        when(graph.findCallees(method.qualifiedName(), 1, "project-1")).thenReturn(List.of());

        AuthorizationEvidence evidence = service.analyze("project-1", 4).getFirst();

        assertThat(evidence.status()).isEqualTo(AuthorizationEvidenceStatus.NO_LOCAL_EVIDENCE);
        assertThat(evidence.constraints()).isEmpty();
        assertThat(evidence.missingInfo())
                .anyMatch(item -> item.contains("does not prove"))
                .anyMatch(item -> item.contains("filter"));
    }

    @Test
    void securityFilterConfigurationIsKeptAsUnverifiedPolicyCandidate() {
        CodeUnit method = method(
                "com.example.UserController#me()",
                "com.example.UserController",
                "UserController.java",
                9,
                "return userService.me();",
                List.of("@GetMapping"),
                Map.of("ann_GetMapping", "/me"));
        CodeUnit config = method(
                "com.example.SecurityConfig#filterChain(HttpSecurity)",
                "com.example.SecurityConfig",
                "SecurityConfig.java",
                15,
                "http.authorizeHttpRequests(auth -> auth.anyRequest().authenticated());",
                List.of("@Bean"),
                Map.of());
        when(graph.findEntryPoints("project-1")).thenReturn(List.of(method));
        when(graph.findSymbol(method.parentQualifiedName(), "project-1")).thenReturn(Optional.empty());
        when(graph.findCallees(method.qualifiedName(), 1, "project-1")).thenReturn(List.of());
        when(diagnostics.listScanTargets("project-1")).thenReturn(List.of(method, config));

        AuthorizationEvidence evidence = service.analyze("project-1", 4).getFirst();

        assertThat(evidence.status()).isEqualTo(AuthorizationEvidenceStatus.POLICY_CANDIDATE);
        assertThat(evidence.constraints()).singleElement().satisfies(constraint -> {
            assertThat(constraint.scope()).isEqualTo(AuthorizationScope.CONFIGURATION);
            assertThat(constraint.effective()).isFalse();
            assertThat(constraint.expression()).contains("anyRequest", "authenticated");
        });
        assertThat(evidence.missingInfo()).anyMatch(item -> item.contains("route coverage"));
    }

    @Test
    void indirectResourceAccessContainsOrderedCallPathAndCitations() {
        CodeUnit entry = method(
                "com.example.UserController#user(String)",
                "com.example.UserController",
                "UserController.java",
                11,
                "return service.load(id);",
                List.of("@GetMapping", "@PreAuthorize"),
                Map.of("ann_GetMapping", "/users/{id}", "ann_PreAuthorize", "#id == authentication.name"));
        CodeUnit serviceMethod = method(
                "com.example.UserService#load(String)",
                "com.example.UserService",
                "UserService.java",
                20,
                "return repository.findById(id).orElseThrow();",
                List.of(),
                Map.of());
        CodeUnit repositoryMethod = method(
                "com.example.UserRepository#findById(String)",
                "com.example.UserRepository",
                "UserRepository.java",
                5,
                "return jdbcTemplate.queryForObject(SQL, mapper, id);",
                List.of(),
                Map.of());
        when(graph.findEntryPoints("project-1")).thenReturn(List.of(entry));
        when(graph.findSymbol(entry.parentQualifiedName(), "project-1")).thenReturn(Optional.empty());
        when(graph.findCallees(entry.qualifiedName(), 1, "project-1")).thenReturn(List.of(serviceMethod));
        when(graph.findCallees(serviceMethod.qualifiedName(), 1, "project-1"))
                .thenReturn(List.of(repositoryMethod));
        when(graph.findCallees(repositoryMethod.qualifiedName(), 1, "project-1")).thenReturn(List.of());

        AuthorizationEvidence evidence = service.analyze("project-1", 4).getFirst();

        assertThat(evidence.resourceAccesses()).anySatisfy(access -> {
            assertThat(access.kind()).isEqualTo("DATABASE");
            assertThat(access.target()).contains("queryForObject");
            assertThat(access.callPath()).containsExactly(
                    entry.qualifiedName(), serviceMethod.qualifiedName(), repositoryMethod.qualifiedName());
            assertThat(access.citations()).extracting(citation -> citation.filePath())
                    .containsExactly("UserController.java", "UserService.java", "UserRepository.java");
        });
    }

    private static CodeUnit type(String qualifiedName, List<String> annotations, Map<String, String> metadata) {
        return new CodeUnit(
                "id-" + qualifiedName,
                CodeUnitKind.CLASS,
                "java",
                qualifiedName,
                qualifiedName.substring(qualifiedName.lastIndexOf('.') + 1),
                "UserController.java",
                5,
                40,
                "class Controller {}",
                null,
                annotations,
                null,
                metadata);
    }

    private static CodeUnit method(
            String qualifiedName,
            String parent,
            String file,
            int line,
            String source,
            List<String> annotations,
            Map<String, String> metadata) {
        return new CodeUnit(
                "id-" + qualifiedName,
                CodeUnitKind.METHOD,
                "java",
                qualifiedName,
                qualifiedName.substring(qualifiedName.indexOf('#') + 1, qualifiedName.indexOf('(')),
                file,
                line,
                line + 3,
                source,
                null,
                annotations,
                parent,
                metadata);
    }
}
