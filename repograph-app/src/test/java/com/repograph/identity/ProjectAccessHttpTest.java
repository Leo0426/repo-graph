package com.repograph.identity;

import com.repograph.app.RepographApplication;
import com.repograph.core.graph.ProjectInfo;
import com.repograph.graph.CodeGraph;
import com.repograph.graph.CodeGraphQueryService;
import com.repograph.vector.embedding.OllamaEmbeddingService;
import com.repograph.vector.store.QdrantVectorStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.neo4j.driver.Driver;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Path;
import java.util.List;

import static org.hamcrest.Matchers.hasSize;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Real application security with only external graph/vector/model infrastructure replaced. @author leolu */
@SpringBootTest(classes = RepographApplication.class)
@AutoConfigureMockMvc
class ProjectAccessHttpTest {
    @TempDir static Path home;
    @MockitoBean Driver driver;
    @MockitoBean CodeGraph graph;
    @MockitoBean CodeGraphQueryService queries;
    @MockitoBean QdrantVectorStore vectors;
    @MockitoBean OllamaEmbeddingService embeddings;
    @Autowired EnterpriseDirectory directory;
    @Autowired MockMvc http;
    @Autowired com.repograph.wiki.SummaryStore summaries;
    @Autowired com.repograph.agent.AgentRunStore agents;
    @Autowired com.repograph.asset.ImportedAssetStore assets;
    @Autowired com.repograph.scanner.ScanTaskStore scanTasks;
    @Autowired com.repograph.scanner.ScannerRunStore scans;
    @Autowired com.repograph.vuln.VulnStore vulnerabilities;
    @Autowired com.repograph.finding.ReviewQueueStore reviews;
    @Autowired com.repograph.finding.RuleSuppressionStore suppressions;


    @DynamicPropertySource
    static void settings(DynamicPropertyRegistry properties) {
        properties.add("user.home", () -> home.toString());
        properties.add("repograph.security.bootstrap-admin-password", () -> "Initial-admin-password-2026");
    }

    @Test
    void snapshotReviewKeepsFrozenFactsWhileExplicitHumanActionsUpdateTheQueue() throws Exception {
        var user = directory.register("humanreview", "Human reviewer", "humanreview@example.test", "Humanreview-password-2026");
        directory.reviewAccount("builtin-admin", user.id(), "ACTIVE", "Approved");
        directory.assignProject("builtin-admin", "eeee11111111", "PERSONAL", user.id());
        var original = snapshot("review-readable", "eeee11111111");
        var entry = reviews.submit(original).getFirst();
        reviews.submit(snapshot("review-private", "ffff22222222"));
        var login = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "humanreview")
                .param("password", "Humanreview-password-2026")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) login.getRequest().getSession(false);
        http.perform(get("/api/v1/review-queue/snapshots/review-readable/review").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].entry.status").value("PENDING"))
                .andExpect(jsonPath("$.items[0].reportMatchCount").value(1))
                .andExpect(jsonPath("$.items[0].report.finding.filePath").value(original.reports().getFirst().finding().filePath()));
        http.perform(get("/api/v1/review-queue/snapshots/review-private/review").session(session)
                .param("projectId", "eeee11111111")).andExpect(status().isForbidden());
        http.perform(post("/api/v1/review-queue/" + entry.id() + "/claim").session(session).with(csrf())
                .contentType("application/json").content("{\"actor\":\"admin\"}"))
                .andExpect(status().isOk());
        http.perform(post("/api/v1/review-queue/" + entry.id() + "/confirm").session(session).with(csrf())
                .contentType("application/json").content("{\"actor\":\"admin\",\"reason\":\"Source and citations checked\"}"))
                .andExpect(status().isOk());
        http.perform(get("/api/v1/review-queue/snapshots/review-readable/review").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].entry.status").value("CONFIRMED"))
                .andExpect(jsonPath("$.snapshot.codeVersion").value("code"));
        org.assertj.core.api.Assertions.assertThat(reviews.getSnapshot(original.id()).orElseThrow()).isEqualTo(original);
        org.assertj.core.api.Assertions.assertThat(reviews.audit(entry.id()).stream()
                .filter(event -> !event.action().equals("SUBMITTED"))).hasSize(2)
                .allMatch(event -> event.actor().equals("humanreview"));
        reviews.submit(new com.repograph.core.finding.ReportSnapshot("review-ambiguous", original.projectId(), "1",
                "fixture", "code", "rules", original.generatedAt(),
                List.of(original.reports().getFirst(), original.reports().getFirst())));
        http.perform(get("/api/v1/review-queue/snapshots/review-ambiguous/review").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].reportMatchCount").value(2))
                .andExpect(jsonPath("$.items[0].report").doesNotExist())
                .andExpect(jsonPath("$.snapshot.reports", hasSize(2)));
    }

    @Test
    void generationCapabilityIsReadableWithoutExposingAdministratorConnectionDetails() throws Exception {
        var user = directory.register("capability", "Capability reader", "capability@example.test", "Capability-password-2026");
        directory.reviewAccount("builtin-admin", user.id(), "ACTIVE", "Approved");
        var login = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "capability")
                .param("password", "Capability-password-2026")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) login.getRequest().getSession(false);
        http.perform(get("/api/v1/capabilities/generation").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.configured").value(true)).andExpect(jsonPath("$.enabled").isBoolean())
                .andExpect(jsonPath("$.baseUrl").doesNotExist()).andExpect(jsonPath("$.apiKey").doesNotExist())
                .andExpect(jsonPath("$.connectionStatus").value("NOT_CHECKED"))
                .andExpect(jsonPath("$.generationStatus").value("NOT_VERIFIED"));
    }

    @Test
    void explicitAuthorizedSearchWorksWithoutAnUnscopedBypass() throws Exception {
        var user = directory.register("searcher", "Searcher", "searcher@example.test", "Searcher-password-2026");
        directory.reviewAccount("builtin-admin", user.id(), "ACTIVE", "Approved");
        directory.assignProject("builtin-admin", "aaaa11111111", "PERSONAL", user.id());
        when(queries.listProjects()).thenReturn(List.of(
                new ProjectInfo("aaaa11111111", "/projects/own", 1, ""),
                new ProjectInfo("bbbb22222222", "/projects/other", 1, "")));
        when(vectors.semanticSearch(org.mockito.ArgumentMatchers.eq("shared"), org.mockito.ArgumentMatchers.any()))
                .thenReturn(new com.repograph.core.vector.SearchPage(List.of(), 0, 10, false));
        var login = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "searcher")
                .param("password", "Searcher-password-2026")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) login.getRequest().getSession(false);
        http.perform(get("/api/v1/search/authorized/semantic").param("q", "shared").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.results", hasSize(0)))
                .andExpect(jsonPath("$.hasMore").value(false));
        http.perform(get("/api/v1/search/semantic").param("q", "shared").session(session))
                .andExpect(status().isForbidden());
        var options = org.mockito.ArgumentCaptor.forClass(com.repograph.core.vector.SearchOptions.class);
        org.mockito.Mockito.verify(vectors).semanticSearch(org.mockito.ArgumentMatchers.eq("shared"), options.capture());
        org.assertj.core.api.Assertions.assertThat(options.getValue().allowedProjectIds())
                .containsExactly("aaaa11111111");
        when(vectors.codeSearch(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any()))
                .thenReturn(new com.repograph.core.vector.SearchPage(List.of(), 0, 10, false));
        http.perform(get("/api/v1/search/authorized/code").param("snippet", "shared")
                .param("projectId", "bbbb22222222").param("allowedProjectIds", "bbbb22222222").session(session))
                .andExpect(status().isOk());
        org.mockito.Mockito.verify(vectors).codeSearch(org.mockito.ArgumentMatchers.eq("shared"), options.capture());
        org.assertj.core.api.Assertions.assertThat(options.getValue().allowedProjectIds())
                .containsExactly("aaaa11111111");
        directory.assignProject("builtin-admin", "aaaa11111111", "PERSONAL", "builtin-admin");
        org.mockito.Mockito.clearInvocations(vectors);
        http.perform(get("/api/v1/search/authorized/semantic").param("q", "shared").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.results", hasSize(0)))
                .andExpect(jsonPath("$.hasMore").value(false));
        org.mockito.Mockito.verifyNoInteractions(vectors);
    }

    @Test
    void projectListingAndQueriesEnforceCurrentOwnershipAndRejectUnscopedAccess() throws Exception {
        when(queries.listProjects()).thenReturn(List.of(
                new ProjectInfo("111111111111", "/projects/alice", 1, ""),
                new ProjectInfo("222222222222", "/projects/bob", 1, ""),
                new ProjectInfo("333333333333", "/projects/legacy", 1, "")));
        var user = directory.register("scoped", "Scoped user", "scoped@example.test", "Scoped-password-2026");
        directory.reviewAccount("builtin-admin", user.id(), "ACTIVE", "Approved");
        directory.assignProject("builtin-admin", "111111111111", "PERSONAL", user.id());
        var login = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "scoped")
                .param("password", "Scoped-password-2026")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) login.getRequest().getSession(false);
        http.perform(get("/api/v1/projects").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1))).andExpect(jsonPath("$[0].projectId").value("111111111111"));
        http.perform(get("/api/v1/summaries").param("projectId", "111111111111").session(session))
                .andExpect(status().isOk());
        http.perform(get("/api/v1/summaries").param("projectId", "222222222222").session(session))
                .andExpect(status().isForbidden());
        http.perform(get("/api/v1/search/semantic").param("q", "secret").session(session))
                .andExpect(status().isForbidden());
        http.perform(get("/api/v1/symbol/secret").param("projectId", "222222222222").session(session))
                .andExpect(status().isForbidden());
        http.perform(post("/api/v1/index/project").param("projectRoot", "/projects/alice")
                .session(session).with(csrf())).andExpect(status().isForbidden());
    }
    @Test
    void documentIdsResolveTheirStoredProjectAndCannotBeOverriddenByAQueryParameter() throws Exception {
        var user = directory.register("reader", "Reader", "reader@example.test", "Reader-password-2026");
        directory.reviewAccount("builtin-admin", user.id(), "ACTIVE", "Approved");
        directory.assignProject("builtin-admin", "444444444444", "PERSONAL", user.id());
        var own = summaries.save(new com.repograph.core.wiki.SummaryDocument("own-document", "444444444444",
                com.repograph.core.wiki.SummaryLevel.PROJECT, "__project__", "Own document",
                List.of(), List.of(), 1, "2026-11-10T00:00:00Z", "COMPLETED"));
        var other = summaries.save(new com.repograph.core.wiki.SummaryDocument("other-document", "555555555555",
                com.repograph.core.wiki.SummaryLevel.PROJECT, "__project__", "Other document",
                List.of(), List.of(), 1, "2026-11-10T00:00:00Z", "COMPLETED"));
        var login = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "reader")
                .param("password", "Reader-password-2026")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) login.getRequest().getSession(false);
        http.perform(get("/api/v1/summaries/" + own.id()).session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Own document"));
        http.perform(get("/api/v1/summaries/" + other.id()).param("projectId", "444444444444").session(session))
                .andExpect(status().isForbidden());
        http.perform(get("/api/v1/summaries/nonexistent").session(session)).andExpect(status().isForbidden());
    }

    @Test
    void bodyScopedFeedbackChecksOwnershipAndUsesAuthenticatedReviewer() throws Exception {
        var user = directory.register("reviewer", "Reviewer", "reviewer@example.test", "Reviewer-password-2026");
        directory.reviewAccount("builtin-admin", user.id(), "ACTIVE", "Approved");
        directory.assignProject("builtin-admin", "666666666666", "PERSONAL", user.id());
        var login = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "reviewer")
                .param("password", "Reviewer-password-2026")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) login.getRequest().getSession(false);
        String feedback = """
                {"projectId":"666666666666","fingerprint":"demo","status":"FALSE_POSITIVE",
                 "reviewer":"admin","reason":"Checked source","codeVersion":"v1","ruleVersion":"v1"}
                """;
        http.perform(post("/api/v1/triage/feedback").session(session).with(csrf())
                .contentType("application/json").content(feedback)).andExpect(status().isOk())
                .andExpect(jsonPath("$.reviewer").value("reviewer"));
        http.perform(post("/api/v1/triage/feedback").session(session).with(csrf())
                .param("projectId", "666666666666").contentType("application/json")
                .content(feedback.replace("666666666666", "777777777777"))).andExpect(status().isForbidden());
    }

    @Test
    void filesystemBackedSbomCannotSubstituteAnUnownedProjectRoot() throws Exception {
        Path root = java.nio.file.Files.createDirectory(home.resolve("sbom-project"));
        java.nio.file.Files.writeString(root.resolve("pom.xml"), """
                <project><modelVersion>4.0.0</modelVersion><groupId>example</groupId>
                <artifactId>owned</artifactId><version>1</version></project>
                """);
        String projectId = com.repograph.core.util.ProjectIdUtil.generateProjectId(root);
        var user = directory.register("sbomreader", "Reader", "sbom@example.test", "Reader-password-2026");
        directory.reviewAccount("builtin-admin", user.id(), "ACTIVE", "Approved");
        directory.assignProject("builtin-admin", projectId, "PERSONAL", user.id());
        var login = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "sbomreader")
                .param("password", "Reader-password-2026")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) login.getRequest().getSession(false);
        http.perform(get("/api/v1/sbom/" + projectId).param("projectRoot", root.toString()).session(session))
                .andExpect(status().isOk());
        http.perform(get("/api/v1/sbom/" + projectId).param("projectRoot", home.toString()).session(session))
                .andExpect(status().isForbidden());
    }

    @Test
    void onlyAdministratorCanManageProvidersAndResponsesNeverReturnCredentials() throws Exception {
        var user = directory.register("modeluser", "Model user", "modeluser@example.test", "Model-password-2026");
        directory.reviewAccount("builtin-admin", user.id(), "ACTIVE", "Approved");
        var userLogin = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "modeluser")
                .param("password", "Model-password-2026")).andExpect(status().isOk()).andReturn();
        var userSession = (MockHttpSession) userLogin.getRequest().getSession(false);
        var adminLogin = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "admin")
                .param("password", "Initial-admin-password-2026")).andExpect(status().isOk()).andReturn();
        var adminSession = (MockHttpSession) adminLogin.getRequest().getSession(false);
        String body = """
                {"name":"Company gateway","protocol":"OPENAI","baseUrl":"https://models.example.test/v1",
                "model":"team-model","enabled":true,"apiKey":"private-provider-credential",
                "timeoutMillis":30000,"maxOutputTokens":4096}
                """;
        http.perform(get("/api/v1/admin/model-providers").session(userSession)).andExpect(status().isForbidden());
        http.perform(post("/api/v1/admin/model-providers").session(userSession).with(csrf())
                .contentType("application/json").content(body)).andExpect(status().isForbidden());
        http.perform(post("/api/v1/admin/model-providers").session(adminSession)
                .contentType("application/json").content(body)).andExpect(status().isForbidden());
        http.perform(post("/api/v1/admin/model-providers/models").session(userSession).with(csrf())
                .contentType("application/json").content(body)).andExpect(status().isForbidden());
        http.perform(post("/api/v1/admin/model-providers/models").session(adminSession)
                .contentType("application/json").content(body)).andExpect(status().isForbidden());
        var result = http.perform(post("/api/v1/admin/model-providers").session(adminSession).with(csrf())
                .contentType("application/json").content(body)).andExpect(status().isCreated())
                .andExpect(jsonPath("$.apiKeyConfigured").value(true)).andExpect(jsonPath("$.apiKey").doesNotExist())
                .andReturn();
        String providerId = new com.fasterxml.jackson.databind.ObjectMapper()
                .readTree(result.getResponse().getContentAsString()).path("id").asText();
        http.perform(post("/api/v1/admin/model-providers/" + providerId + "/select")
                .session(adminSession).with(csrf())).andExpect(status().isOk())
                .andExpect(jsonPath("$.selected").value(true));
        var listing = http.perform(get("/api/v1/admin/model-providers").session(adminSession))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat(listing).doesNotContain("private-provider-credential", "encrypted_key");
        var catalogServer = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        catalogServer.createContext("/v1/models", exchange -> {
            org.assertj.core.api.Assertions.assertThat(exchange.getRequestHeaders().getFirst("Authorization"))
                    .isEqualTo("Bearer draft-model-key");
            byte[] bytes = "{\"data\":[{\"id\":\"catalog-model\"}]}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        catalogServer.start();
        try {
            String draft = """
                    {"protocol":"OPENAI_COMPATIBLE","baseUrl":"http://127.0.0.1:%d/v1",
                     "apiKey":"draft-model-key","timeoutMillis":1000}
                    """.formatted(catalogServer.getAddress().getPort());
            http.perform(post("/api/v1/admin/model-providers/models").session(adminSession).with(csrf())
                    .contentType("application/json").content(draft)).andExpect(status().isOk())
                    .andExpect(jsonPath("$.models[0]").value("catalog-model"))
                    .andExpect(jsonPath("$.apiKey").doesNotExist());
            var after = http.perform(get("/api/v1/admin/model-providers").session(adminSession))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            org.assertj.core.api.Assertions.assertThat(after).isEqualTo(listing).doesNotContain("draft-model-key");
        } finally { catalogServer.stop(0); }
        http.perform(get("/api/v1/agent-settings/llm").session(adminSession)).andExpect(status().isOk())
                .andExpect(jsonPath("$.provider").value("OPENAI"));
        http.perform(get("/api/v1/admin/audit").session(adminSession)).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.action == 'PROVIDER_CREATED')].actorId",
                        org.hamcrest.Matchers.hasItem("builtin-admin")))
                .andExpect(jsonPath("$[?(@.action == 'PROVIDER_SELECTED')].targetId",
                        org.hamcrest.Matchers.hasItem(providerId)));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.EnumSource(ResourceFixture.class)
    void opaqueResourcesUsePersistedOwnershipInsteadOfSpoofedProjectParameters(ResourceFixture kind) throws Exception {
        String username = "resource_" + kind.name().toLowerCase(java.util.Locale.ROOT);
        var user = directory.register(username, "Resource reader", username + "@example.test", "Reader-password-2026");
        directory.reviewAccount("builtin-admin", user.id(), "ACTIVE", "Approved");
        directory.assignProject("builtin-admin", "888888888888", "PERSONAL", user.id());
        directory.assignProject("builtin-admin", "999999999999", "PERSONAL", "builtin-admin");
        String own = resource(kind, kind.name() + "-own", "888888888888");
        String other = resource(kind, kind.name() + "-other", "999999999999");
        var login = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", username)
                .param("password", "Reader-password-2026")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) login.getRequest().getSession(false);
        http.perform(get("/api/v1" + own).session(session)).andExpect(status().isOk());
        http.perform(get("/api/v1" + other).session(session).param("projectId", "888888888888"))
                .andExpect(status().isForbidden());
    }

    @Test
    void batchExportAuthorizesEverySnapshotBeforeProducingAnArchive() throws Exception {
        var user = directory.register("exporter", "Exporter", "exporter@example.test", "Exporter-password-2026");
        directory.reviewAccount("builtin-admin", user.id(), "ACTIVE", "Approved");
        directory.assignProject("builtin-admin", "abababababab", "PERSONAL", user.id());
        reviews.submit(snapshot("allowed-export", "abababababab"));
        reviews.submit(snapshot("denied-export", "cdcdcdcdcdcd"));
        var login = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "exporter")
                .param("password", "Exporter-password-2026")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) login.getRequest().getSession(false);
        http.perform(post("/api/v1/review-queue/snapshots/export-batch").session(session).with(csrf())
                .contentType("application/json").content("{\"snapshotIds\":[\"allowed-export\"],\"format\":\"json\"}"))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content()
                        .contentTypeCompatibleWith("application/zip"));
        http.perform(post("/api/v1/review-queue/snapshots/export-batch").session(session).with(csrf())
                .param("projectId", "abababababab").contentType("application/json")
                .content("{\"snapshotIds\":[\"allowed-export\",\"denied-export\"],\"format\":\"json\"}"))
                .andExpect(status().isForbidden());
        var org = directory.createOrganization("builtin-admin", "Export team");
        directory.setMembership("builtin-admin", org.id(), user.id(), true);
        directory.assignProject("builtin-admin", "abababababab", "ORGANIZATION", org.id());
        http.perform(get("/api/v1/review-queue/snapshots/allowed-export/export?format=json").session(session))
                .andExpect(status().isOk());
        directory.setMembership("builtin-admin", org.id(), user.id(), false);
        http.perform(get("/api/v1/review-queue/snapshots/allowed-export/export?format=json").session(session))
                .andExpect(status().isForbidden());
    }

    private enum ResourceFixture { ASSET, AGENT, SCAN_TASK, SCAN_RUN, VULNERABILITY, SNAPSHOT, REVIEW_ENTRY, SUPPRESSION }

    private String resource(ResourceFixture kind, String id, String project) {
        String timestamp = "2026-11-10T00:00:00Z";
        switch (kind) {
            case ASSET -> {
                assets.save(new com.repograph.core.asset.ImportedAsset(id, project, "fixture.zip", "ZIP",
                        home.resolve(id), com.repograph.core.asset.AssetStatus.READY, "", timestamp, timestamp, null));
                return "/assets/" + id;
            }
            case AGENT -> {
                agents.create(new com.repograph.core.agent.AgentRun(id, project,
                        com.repograph.core.agent.AgentPlaybook.WIKI_SUMMARY, "1",
                        com.repograph.core.agent.AgentRunStatus.COMPLETED, "", "", "", timestamp, timestamp,
                        timestamp, List.of()));
                return "/agent-runs/" + id;
            }
            case SCAN_TASK -> {
                scanTasks.create(new com.repograph.core.scanner.ScanTask(id, project, "fixture-asset", List.of(),
                        List.of(), 60, com.repograph.core.scanner.ScanTaskStatus.FAILED, 1, "", "fixture", timestamp, timestamp));
                return "/scan-tasks/" + id;
            }
            case SCAN_RUN -> {
                scans.save("batch-" + id, new com.repograph.core.scanner.ScannerRunResult(id, project, "fixture",
                        com.repograph.core.scanner.ScannerRunStatus.SUCCEEDED, "1", 0, 1, timestamp, timestamp,
                        List.of(), ""));
                return "/scans/" + id;
            }
            case VULNERABILITY -> {
                vulnerabilities.upsertAll(List.of(new com.repograph.vuln.VulnFinding(id, project, "SQL_INJECTION",
                        "CWE-89", "HIGH", "SUSPECTED", "unit", "Example.run", "Example.java", 1,
                        "Fixture finding", "Evidence", timestamp)));
                return "/vulns/" + id + "/taint-evidence";
            }
            case SNAPSHOT, REVIEW_ENTRY -> {
                var entries = reviews.submit(snapshot(id, project));
                return kind == ResourceFixture.SNAPSHOT ? "/review-queue/snapshots/" + id + "/export?format=json"
                        : "/review-queue/" + entries.getFirst().id() + "/audit";
            }
            case SUPPRESSION -> {
                suppressions.create(new com.repograph.core.finding.RuleSuppression(id, project, "fixture-rule",
                        com.repograph.core.finding.RuleSuppressionScope.PROJECT, "", "Fixture", "admin", timestamp,
                        "2027-11-10T00:00:00Z", true));
                return "/triage/suppressions/" + id + "/audit";
            }
        }
        throw new AssertionError(kind);
    }

    private com.repograph.core.finding.ReportSnapshot snapshot(String id, String project) {
        var finding = new com.repograph.core.finding.ExternalFinding("fixture", "rule", "CWE-78",
                com.repograph.core.finding.ExternalFindingSeverity.HIGH, "Finding", "Example.java", 1, 1,
                "Example.run", List.of(), "");
        var pack = new com.repograph.core.retrieval.ContextPack("q", "security", List.of(), List.of(),
                100, 0, 0, 0, 0, 0);
        var report = new com.repograph.core.finding.TriageReport(finding, true, "Example.run",
                com.repograph.core.finding.TriageVerdict.NEEDS_REVIEW, 0.5f, List.of(), List.of(), "fix", "summary", pack);
        return new com.repograph.core.finding.ReportSnapshot(id, project, "1", "fixture", "code", "rules",
                "2026-11-10T00:00:00Z", List.of(report));
    }

}
