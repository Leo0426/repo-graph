package com.repograph.mcp.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/** MCP HTTP client authentication through the same session/CSRF contract as the Web client. @author leolu */
class RepographApiAuthenticationTest {
    @Test
    void logsInWithCsrfKeepsSessionAndReauthenticatesAfterExpiry() throws Exception {
        var logins = new AtomicInteger();
        var mutations = new AtomicInteger();
        var authenticated = new AtomicBoolean(false);
        var loginBody = new java.util.concurrent.atomic.AtomicReference<String>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/auth/csrf", exchange -> {
            exchange.getResponseHeaders().add("Set-Cookie", "JSESSIONID=fixture; Path=/; HttpOnly; SameSite=Lax");
            respond(exchange, 200, "{\"headerName\":\"X-CSRF-TOKEN\",\"token\":\"fixture-csrf\"}");
        });
        server.createContext("/api/v1/auth/login", exchange -> {
            loginBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            if (!"fixture-csrf".equals(exchange.getRequestHeaders().getFirst("X-CSRF-TOKEN"))) {
                respond(exchange, 403, "{}"); return;
            }
            logins.incrementAndGet(); authenticated.set(true); respond(exchange, 200, "{\"username\":\"employee\"}");
        });
        server.createContext("/api/v1/projects", exchange -> {
            String cookie = exchange.getRequestHeaders().getFirst("Cookie");
            if (!authenticated.get() || cookie == null || !cookie.contains("JSESSIONID=fixture")) {
                respond(exchange, 401, "{}"); return;
            }
            if (exchange.getRequestMethod().equals("POST")) {
                if (!"fixture-csrf".equals(exchange.getRequestHeaders().getFirst("X-CSRF-TOKEN"))) {
                    respond(exchange, 403, "{}"); return;
                }
                mutations.incrementAndGet();
            }
            respond(exchange, 200, "{\"ok\":true}");
        });
        server.start();
        try {
            var client = new RepographApiClient(new ObjectMapper(), 2, "employee", "private + password");
            client.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
            assertThat(client.get("/api/v1/projects")).isPresent();
            assertThat(client.postJson("/api/v1/projects", "{}").path("ok").asBoolean()).isTrue();
            assertThat(logins.get()).isEqualTo(1);
            assertThat(mutations.get()).isEqualTo(1);
            assertThat(loginBody.get()).isEqualTo("username=employee&password=private+%2B+password");
            authenticated.set(false);
            assertThat(client.get("/api/v1/projects")).isPresent();
            assertThat(logins.get()).isEqualTo(2);
        } finally { server.stop(0); }
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, int status, String text)
            throws java.io.IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
