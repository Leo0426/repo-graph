package com.repograph.mcp.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;

/** HTTP client using the same authenticated session and CSRF contract as the Web UI. @author leolu */
@Component
public class RepographApiClient {
    private static final Logger log = LoggerFactory.getLogger(RepographApiClient.class);
    private final ObjectMapper mapper;
    private final HttpClient http;
    private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ORIGINAL_SERVER);
    private final Duration requestTimeout;
    private final String username;
    private final String password;
    private volatile String baseUrl;
    private volatile boolean authenticated;
    private volatile long sessionVersion;

    /** Configures credentials from the environment-backed runtime settings, without logging them. */
    @Autowired
    public RepographApiClient(ObjectMapper mapper,
                              @Value("${repograph.timeout-seconds:30}") int timeoutSeconds,
                              @Value("${repograph.auth.username:}") String username,
                              @Value("${repograph.auth.password:}") String password) {
        this.mapper = mapper;
        this.requestTimeout = Duration.ofSeconds(timeoutSeconds);
        this.username = username == null ? "" : username;
        this.password = password == null ? "" : password;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
                .cookieHandler(cookies).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    /** Creates a client without automatic login; protected endpoints still require server authorization. */
    public RepographApiClient(ObjectMapper mapper, int timeoutSeconds) {
        this(mapper, timeoutSeconds, "", "");
    }

    /** Sets the API origin/prefix and discards credentials for the previous session. */
    public synchronized void setBaseUrl(String baseUrl) {
        URI uri;
        try { uri = URI.create(baseUrl); }
        catch (RuntimeException invalid) { throw new IllegalArgumentException("Invalid RepoGraph base URL"); }
        if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null
                || uri.getFragment() != null) {
            throw new IllegalArgumentException("RepoGraph base URL must be HTTP(S) without credentials or query");
        }
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        cookies.getCookieStore().removeAll();
        authenticated = false;
        sessionVersion++;
        log.info("RepoGraph API target: {}", this.baseUrl);
    }

    /** Executes GET; a missing resource returns an empty Optional. */
    public Optional<JsonNode> get(String path) { return execute("GET", path, ""); }

    /** Executes a POST without a body, including a fresh session CSRF token. */
    public JsonNode post(String path) { return execute("POST", path, "").orElseThrow(); }

    /** Executes a JSON POST, including a fresh session CSRF token. */
    public JsonNode postJson(String path, String json) { return execute("POST", path, json == null ? "" : json).orElseThrow(); }

    private Optional<JsonNode> execute(String method, String path, String body) {
        if (baseUrl == null) throw new RepographApiException("RepoGraph base URL not configured");
        if (path == null || !path.startsWith("/") || path.startsWith("//")) {
            throw new RepographApiException("RepoGraph API path must be relative to its configured origin");
        }
        try {
            authenticate(-1);
            long version = sessionVersion;
            String token = usesCredentials() && !method.equals("GET") ? csrfToken() : null;
            var response = send(method, path, body, "application/json", token);
            if (response.statusCode() == 401 && usesCredentials()) {
                authenticate(version);
                token = !method.equals("GET") ? csrfToken() : null;
                response = send(method, path, body, "application/json", token);
            }
            if (response.statusCode() == 404 && method.equals("GET")) return Optional.empty();
            if (response.statusCode() == 401) {
                throw new RepographApiException("RepoGraph authentication required; configure REPOGRAPH_USERNAME and "
                        + "REPOGRAPH_PASSWORD with an approved account");
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new RepographApiException("RepoGraph API error " + response.statusCode());
            }
            return Optional.of(mapper.readTree(response.body()));
        } catch (RepographApiException error) {
            throw error;
        } catch (java.net.ConnectException error) {
            throw new RepographApiException("Cannot connect to repograph-app. Is the Web service running?", error);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new RepographApiException("HTTP request interrupted", error);
        } catch (Exception error) {
            throw new RepographApiException("RepoGraph HTTP request failed", error);
        }
    }

    private boolean usesCredentials() { return !username.isBlank() || !password.isEmpty(); }

    private synchronized void authenticate(long expiredVersion) throws Exception {
        if (!usesCredentials()) return;
        if (username.isBlank() || password.isEmpty()) {
            throw new RepographApiException("Both REPOGRAPH_USERNAME and REPOGRAPH_PASSWORD are required");
        }
        if (authenticated && (expiredVersion < 0 || sessionVersion != expiredVersion)) return;
        authenticated = false;
        String token = csrfToken();
        String body = "username=" + URLEncoder.encode(username, StandardCharsets.UTF_8)
                + "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8);
        var login = send("POST", "/api/v1/auth/login", body, "application/x-www-form-urlencoded", token);
        if (login.statusCode() != 200) {
            throw new RepographApiException("RepoGraph login failed; check credentials and administrator approval");
        }
        authenticated = true;
        sessionVersion++;
    }

    private String csrfToken() throws Exception {
        var response = send("GET", "/api/v1/auth/csrf", "", "application/json", null);
        if (response.statusCode() != 200) throw new RepographApiException("Cannot obtain RepoGraph CSRF token");
        JsonNode result = mapper.readTree(response.body());
        if (!"X-CSRF-TOKEN".equals(result.path("headerName").asText()) || result.path("token").asText().isBlank()) {
            throw new RepographApiException("Invalid RepoGraph CSRF response");
        }
        return result.path("token").asText();
    }

    private HttpResponse<String> send(String method, String path, String body, String contentType, String csrf)
            throws java.io.IOException, InterruptedException {
        var builder = HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(requestTimeout)
                .header("Accept", "application/json");
        if (csrf != null) builder.header("X-CSRF-TOKEN", csrf);
        if (method.equals("GET")) builder.GET();
        else builder.header("Content-Type", contentType)
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    /** Safe outer error for a failed RepoGraph request. */
    @SuppressWarnings("serial")
    public static class RepographApiException extends RuntimeException {
        /** Creates a request error. */
        public RepographApiException(String message) { super(message); }
        /** Creates an error retaining transport cancellation/timeout evidence. */
        public RepographApiException(String message, Throwable cause) { super(message, cause); }
    }
}
