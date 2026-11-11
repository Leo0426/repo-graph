package com.repograph.modelprovider;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Model discovery uses real local HTTP without saving drafts or invoking generation. @author leolu */
class ModelCatalogTest {
    @TempDir Path temporary;

    @ParameterizedTest
    @ValueSource(strings = {"OPENAI", "OPENAI_COMPATIBLE"})
    void listsDraftModelsWithItsKeyWithoutSavingOrGenerating(String protocol) throws Exception {
        var method = new AtomicReference<String>();
        var authorization = new AtomicReference<String>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/gateway/v1/models", exchange -> {
            method.set(exchange.getRequestMethod());
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] bytes = """
                    {"data":[{"id":"team/beta"},{"id":"alpha"},{"id":"alpha"}]}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try {
            var store = new ModelProviderStore(temporary.resolve("index.db").toString(), "", false,
                    "http://localhost:11434", "legacy");
            var before = store.list();
            var catalog = new ModelCatalog(store, new ObjectMapper());
            var models = catalog.list(new ModelProviderStore.CatalogInput(null, protocol,
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/gateway/v1/",
                    "draft-secret", false, 1000));
            assertThat(models).containsExactly("alpha", "team/beta");
            assertThat(method.get()).isEqualTo("GET");
            assertThat(authorization.get()).isEqualTo("Bearer draft-secret");
            assertThat(store.list()).isEqualTo(before);
            assertThat(store.auditEvents(10)).isEmpty();
        } finally { server.stop(0); }
    }

    @Test
    void anthropicUsesItsAuthenticationAndFollowsBoundedCursorPages() throws Exception {
        try (var fixture = new Fixture()) {
            var queries = new java.util.ArrayList<String>();
            fixture.server.createContext("/v1/models", exchange -> {
                assertThat(exchange.getRequestHeaders().getFirst("x-api-key")).isEqualTo("secret");
                assertThat(exchange.getRequestHeaders().getFirst("anthropic-version")).isEqualTo("2023-06-01");
                assertThat(exchange.getRequestHeaders().getFirst("Authorization")).isNull();
                String query = exchange.getRequestURI().getRawQuery();
                queries.add(query);
                reply(exchange, 200, queries.size() == 1
                        ? "{\"data\":[{\"id\":\"claude/a+b\"}],\"has_more\":true,\"last_id\":\"claude/a+b\"}"
                        : "{\"data\":[{\"id\":\"claude-next\"}],\"has_more\":false}");
            });
            assertThat(fixture.catalog.list(fixture.input("ANTHROPIC", "secret")))
                    .containsExactly("claude-next", "claude/a+b");
            assertThat(queries).hasSize(2);
            assertThat(queries.get(1)).contains("after_id=claude%2Fa%2Bb");
        }
    }

    @Test
    void ollamaListsInstalledNamesWithoutRequiringAKeyOrGenerating() throws Exception {
        try (var fixture = new Fixture()) {
            fixture.server.createContext("/v1/api/tags", exchange -> {
                assertThat(exchange.getRequestMethod()).isEqualTo("GET");
                assertThat(exchange.getRequestHeaders().getFirst("Authorization")).isNull();
                reply(exchange, 200, "{\"models\":[{\"name\":\"local:latest\",\"model\":\"local:latest\"}]}");
            });
            assertThat(fixture.catalog.list(fixture.input("OLLAMA", ""))).containsExactly("local:latest");
        }
    }

    @Test
    void savedKeyIsReusedOnlyForTheSameEndpointAndProtocol() throws Exception {
        try (var fixture = new Fixture()) {
            var key = new AtomicReference<String>();
            fixture.server.createContext("/v1/models", exchange -> {
                key.set(exchange.getRequestHeaders().getFirst("Authorization"));
                reply(exchange, 200, "{\"data\":[]}");
            });
            var saved = fixture.store.save(null, new ModelProviderStore.ProviderInput("Saved", "OPENAI",
                    fixture.url(), "manual", false, "stored-secret", false, 1000, 4096));
            var input = new ModelProviderStore.CatalogInput(saved.id(), "OPENAI", fixture.url(), "", false, 1000);
            var before = fixture.store.list();
            assertThat(fixture.catalog.list(input)).isEmpty();
            assertThat(key.get()).isEqualTo("Bearer stored-secret");
            assertThat(fixture.store.list()).isEqualTo(before);
            assertThatThrownBy(() -> fixture.catalog.list(new ModelProviderStore.CatalogInput(saved.id(),
                    "OPENAI", fixture.url() + "/other", "", false, 1000)))
                    .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("new or cleared API key");
            assertThatThrownBy(() -> fixture.catalog.list(new ModelProviderStore.CatalogInput(saved.id(),
                    "OPENAI_COMPATIBLE", fixture.url(), "", false, 1000)))
                    .isInstanceOf(IllegalArgumentException.class);
            fixture.catalog.list(new ModelProviderStore.CatalogInput(saved.id(), "OPENAI", fixture.url(),
                    "replacement", false, 1000));
            assertThat(key.get()).isEqualTo("Bearer replacement");
            fixture.catalog.list(new ModelProviderStore.CatalogInput(saved.id(), "OPENAI", fixture.url(),
                    "", true, 1000));
            assertThat(key.get()).isNull();
            assertThat(fixture.store.resolve(saved.id()).apiKey()).isEqualTo("stored-secret");
            assertThat(input.toString()).doesNotContain("stored-secret");
            assertThat(new ObjectMapper().writeValueAsString(input)).doesNotContain("apiKey");
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {301, 401, 403, 404, 429, 500})
    void failuresNeverForwardRedirectsOrEchoUpstreamSecrets(int status) throws Exception {
        try (var fixture = new Fixture()) {
            var forwarded = new java.util.concurrent.atomic.AtomicInteger();
            fixture.server.createContext("/v1/models", exchange -> {
                exchange.getResponseHeaders().set("Location", fixture.url() + "/leak");
                reply(exchange, status, "secret error body private-secret");
            });
            fixture.server.createContext("/v1/leak", exchange -> { forwarded.incrementAndGet(); exchange.close(); });
            assertThatThrownBy(() -> fixture.catalog.list(fixture.input("OPENAI", "private-secret")))
                    .isInstanceOf(ModelCatalog.DiscoveryException.class).hasMessageContaining("HTTP " + status)
                    .hasMessageNotContaining("private-secret").hasNoCause();
            assertThat(forwarded).hasValue(0);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "{}", "not json private-secret", "{\"data\":[{\"id\":5}]}",
            "{\"data\":[{\"id\":\"bad\\nvalue\"}]}",
            "{\"data\":[{\"id\":\"loop\"}],\"has_more\":true,\"last_id\":\"loop\"}"})
    void invalidOrRepeatingPagesFailSafely(String response) throws Exception {
        try (var fixture = new Fixture()) {
            fixture.server.createContext("/v1/models", exchange -> reply(exchange, 200, response));
            assertThatThrownBy(() -> fixture.catalog.list(fixture.input("ANTHROPIC", "private-secret")))
                    .isInstanceOf(ModelCatalog.DiscoveryException.class)
                    .hasMessageNotContaining("private-secret").hasNoCause();
        }
    }

    @Test
    void totalDeadlineCoversSlowBodyAndResponseSizeIsBounded() throws Exception {
        try (var fixture = new Fixture()) {
            fixture.server.createContext("/v1/models", exchange -> {
                exchange.sendResponseHeaders(200, 0);
                try {
                    for (int i = 0; i < 40; i++) {
                        exchange.getResponseBody().write(' '); exchange.getResponseBody().flush();
                        Thread.sleep(100);
                    }
                } catch (Exception cancelled) { /* Client cancellation closes the stream. */ }
                finally { exchange.close(); }
            });
            long started = System.nanoTime();
            assertThatThrownBy(() -> fixture.catalog.list(fixture.input("OPENAI", "")))
                    .isInstanceOf(ModelCatalog.DiscoveryException.class).hasMessageContaining("超时");
            assertThat(java.time.Duration.ofNanos(System.nanoTime() - started).toMillis()).isLessThan(2500);
        }
        try (var fixture = new Fixture()) {
            fixture.server.createContext("/v1/models", exchange -> reply(exchange, 200, " ".repeat(2 * 1024 * 1024 + 1)));
            assertThatThrownBy(() -> fixture.catalog.list(fixture.input("OPENAI", "")))
                    .isInstanceOf(ModelCatalog.DiscoveryException.class).hasMessageContaining("过大");
        }
    }

    private static void reply(com.sun.net.httpserver.HttpExchange exchange, int status, String body)
            throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes); exchange.close();
    }

    private final class Fixture implements AutoCloseable {
        private final HttpServer server;
        private final ModelProviderStore store;
        private final ModelCatalog catalog;
        private Fixture() throws Exception {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.setExecutor(java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor());
            server.start();
            store = new ModelProviderStore(temporary.resolve(java.util.UUID.randomUUID() + ".db").toString(),
                    "", false, "http://localhost:11434", "legacy");
            catalog = new ModelCatalog(store, new ObjectMapper());
        }
        private String url() { return "http://127.0.0.1:" + server.getAddress().getPort() + "/v1"; }
        private ModelProviderStore.CatalogInput input(String protocol, String key) {
            return new ModelProviderStore.CatalogInput(null, protocol, url(), key, false, 1000);
        }
        @Override public void close() { server.stop(0); }
    }
}
