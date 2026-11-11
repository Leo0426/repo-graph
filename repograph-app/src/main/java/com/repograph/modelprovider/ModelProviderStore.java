package com.repograph.modelprovider;

import com.repograph.core.modelprovider.ModelProvider;
import com.repograph.core.modelprovider.ModelProvider.Protocol;
import com.repograph.persistence.SqliteDatabasePath;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Persistent generation providers, selection and encrypted credentials. @author leolu */
@Service
public class ModelProviderStore {
    private final String database;
    private final ProviderSecretCipher cipher;

    /** Initializes providers once, preserving the saved legacy Ollama configuration if present. */
    public ModelProviderStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String database,
            @Value("${repograph.security.provider-encryption-key:}") String encryptionKey,
            @Value("${repograph.advisory.enabled:false}") boolean defaultEnabled,
            @Value("${repograph.advisory.ollama.base-url}") String defaultUrl,
            @Value("${repograph.advisory.ollama.model}") String defaultModel) {
        this.database = SqliteDatabasePath.prepare(database);
        initialize(defaultEnabled, defaultUrl, defaultModel);
        cipher = new ProviderSecretCipher(Path.of(database).toAbsolutePath().getParent()
                .resolve("provider-encryption-key"), encryptionKey, hasEncryptedData());
        // Fail startup for an incorrect key instead of presenting saved providers as usable.
        for (ModelProvider provider : list()) resolve(provider.id());
    }

    /** Lists credential-free configuration, including disabled providers. */
    public synchronized List<ModelProvider> list() {
        try (var connection = connection(); var statement = connection.createStatement();
             var rows = statement.executeQuery("SELECT * FROM model_providers ORDER BY name, id")) {
            List<ModelProvider> result = new ArrayList<>();
            while (rows.next()) result.add(fromRow(rows));
            return List.copyOf(result);
        } catch (SQLException error) { throw storageFailure(); }
    }

    /** Returns the selected configuration even when generation is disabled. */
    public synchronized ModelProvider current() {
        return list().stream().filter(ModelProvider::selected).findFirst()
                .orElseThrow(() -> new IllegalStateException("No generation provider selected"));
    }

    /** Creates or replaces a profile; a null or blank API key preserves the existing secret. */
    public synchronized ModelProvider save(String id, ProviderInput input) {
        return save(id, input, Instant.now().toString());
    }

    /** Saves with an explicit timestamp for legacy settings compatibility. */
    public synchronized ModelProvider save(String id, ProviderInput input, String updatedAt) {
        return save(id, input, updatedAt, "system");
    }

    /** Saves configuration and the administrator audit event in the same transaction. */
    public synchronized ModelProvider save(String id, ProviderInput input, String updatedAt, String actorId) {
        String actor = requiredText(actorId, "Actor", 100);
        if (input == null) throw new IllegalArgumentException("Provider configuration is required");
        Instant.parse(updatedAt);
        String name = requiredText(input.name(), "Provider name", 100);
        Protocol protocol;
        try { protocol = Protocol.valueOf(input.protocol()); }
        catch (Exception invalid) { throw new IllegalArgumentException("Unsupported model protocol"); }
        String baseUrl = normalizeUrl(input.baseUrl());
        String model = requiredText(input.model(), "Model", 200);
        if (input.timeoutMillis() < 1000 || input.timeoutMillis() > 600000) {
            throw new IllegalArgumentException("Timeout must be between 1000 and 600000 ms");
        }
        if (input.maxOutputTokens() < 1 || input.maxOutputTokens() > 65536) {
            throw new IllegalArgumentException("Output limit must be between 1 and 65536 tokens");
        }
        validatePrices(input.inputUsdPerMillionTokens(), input.outputUsdPerMillionTokens());
        boolean creating = id == null;
        String providerId = creating ? UUID.randomUUID().toString() : id;
        try (var connection = connection()) {
            connection.setAutoCommit(false);
            String secret = "";
            boolean selected = false;
            if (!creating) {
                try (var query = connection.prepareStatement("SELECT * FROM model_providers WHERE id=?")) {
                    query.setString(1, providerId);
                    try (var row = query.executeQuery()) {
                        if (!row.next()) throw new IllegalArgumentException("Provider does not exist");
                        secret = row.getString("encrypted_key");
                        selected = row.getBoolean("selected");
                        // Do not silently send a saved credential to a newly supplied destination/protocol.
                        if ((!baseUrl.equals(row.getString("base_url"))
                                || !protocol.name().equals(row.getString("protocol"))) && !secret.isEmpty()
                                && !input.clearApiKey() && (input.apiKey() == null || input.apiKey().isBlank())) {
                            throw new IllegalArgumentException("Changing the endpoint or protocol requires a new or cleared API key");
                        }
                    }
                }
            }
            if (input.clearApiKey()) secret = "";
            if (input.apiKey() != null && !input.apiKey().isBlank()) {
                if (input.clearApiKey()) throw new IllegalArgumentException("Cannot replace and clear API key together");
                String apiKey = requiredText(input.apiKey(), "API key", 8192);
                secret = cipher.encrypt(providerId, apiKey);
            }
            try (var statement = connection.prepareStatement("""
                    INSERT INTO model_providers
                    (id,name,protocol,base_url,model,enabled,selected,encrypted_key,timeout_millis,max_output_tokens,
                    updated_at,input_usd_per_million,output_usd_per_million)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET name=excluded.name,protocol=excluded.protocol,
                    base_url=excluded.base_url,model=excluded.model,enabled=excluded.enabled,
                    encrypted_key=excluded.encrypted_key,timeout_millis=excluded.timeout_millis,
                    max_output_tokens=excluded.max_output_tokens,updated_at=excluded.updated_at,
                    input_usd_per_million=excluded.input_usd_per_million,output_usd_per_million=excluded.output_usd_per_million
                    """)) {
                statement.setString(1, providerId);
                statement.setString(2, name);
                statement.setString(3, protocol.name());
                statement.setString(4, baseUrl);
                statement.setString(5, model);
                statement.setBoolean(6, input.enabled());
                statement.setBoolean(7, selected);
                statement.setString(8, secret);
                statement.setInt(9, input.timeoutMillis());
                statement.setInt(10, input.maxOutputTokens());
                statement.setString(11, updatedAt);
                statement.setObject(12, input.inputUsdPerMillionTokens());
                statement.setObject(13, input.outputUsdPerMillionTokens());
                statement.executeUpdate();
            }
            audit(connection, actor, creating ? "PROVIDER_CREATED" : "PROVIDER_UPDATED", providerId);
            connection.commit();
        } catch (SQLException error) { throw storageFailure(); }
        return find(providerId);
    }

    /** Atomically selects an enabled provider for subsequent generation calls. */
    public synchronized ModelProvider select(String id) {
        return select(id, "system");
    }

    /** Selects a provider and audits the actor atomically. */
    public synchronized ModelProvider select(String id, String actorId) {
        String actor = requiredText(actorId, "Actor", 100);
        ModelProvider provider = find(id);
        if (!provider.enabled()) throw new IllegalArgumentException("Enable the provider before selecting it");
        try (var connection = connection()) {
            connection.setAutoCommit(false);
            try (var clear = connection.createStatement();
                 var select = connection.prepareStatement("UPDATE model_providers SET selected=1 WHERE id=?")) {
                clear.executeUpdate("UPDATE model_providers SET selected=0");
                select.setString(1, id);
                select.executeUpdate();
                audit(connection, actor, "PROVIDER_SELECTED", id);
                connection.commit();
            }
        } catch (SQLException error) { throw storageFailure(); }
        return find(id);
    }

    /** Deletes an unused profile; the selected profile must first be replaced. */
    public synchronized void delete(String id) {
        delete(id, "system");
    }

    /** Deletes a non-selected provider and retains the actor audit event atomically. */
    public synchronized void delete(String id, String actorId) {
        String actor = requiredText(actorId, "Actor", 100);
        if (find(id).selected()) throw new IllegalArgumentException("Select another provider before deleting this one");
        try (var connection = connection();
             var statement = connection.prepareStatement("DELETE FROM model_providers WHERE id=?")) {
            connection.setAutoCommit(false);
            statement.setString(1, id);
            statement.executeUpdate();
            audit(connection, actor, "PROVIDER_DELETED", id);
            connection.commit();
        } catch (SQLException error) { throw storageFailure(); }
    }

    /** Resolves the selected profile and credential for server-side transport only. */
    public synchronized ResolvedProvider resolveCurrent() { return resolve(current().id()); }

    /** Resolves one saved provider for transport or an explicit connection test. Never return this from an API. */
    public synchronized ResolvedProvider resolve(String id) {
        try (var connection = connection();
             var statement = connection.prepareStatement("SELECT * FROM model_providers WHERE id=?")) {
            statement.setString(1, id);
            try (var row = statement.executeQuery()) {
                if (!row.next()) throw new IllegalArgumentException("Provider does not exist");
                return new ResolvedProvider(fromRow(row), cipher.decrypt(id, row.getString("encrypted_key")));
            }
        } catch (SQLException error) { throw storageFailure(); }
    }

    /** Resolves a discovery draft without persistence; saved credentials stay bound to their endpoint and protocol. */
    public synchronized CatalogConnection resolveCatalog(CatalogInput input) {
        if (input == null) throw new IllegalArgumentException("Model discovery configuration is required");
        Protocol protocol;
        try { protocol = Protocol.valueOf(input.protocol()); }
        catch (Exception invalid) { throw new IllegalArgumentException("Unsupported model protocol"); }
        String baseUrl = normalizeUrl(input.baseUrl());
        if (input.timeoutMillis() < 1000 || input.timeoutMillis() > 600000) {
            throw new IllegalArgumentException("Timeout must be between 1000 and 600000 ms");
        }
        boolean replacing = input.apiKey() != null && !input.apiKey().isBlank();
        if (replacing && input.clearApiKey()) {
            throw new IllegalArgumentException("Cannot replace and clear API key together");
        }
        String apiKey = replacing ? requiredText(input.apiKey(), "API key", 8192) : "";
        if (input.providerId() != null) {
            var saved = resolve(input.providerId());
            if (!replacing && !input.clearApiKey() && !saved.apiKey().isEmpty()) {
                if (!baseUrl.equals(saved.configuration().baseUrl()) || protocol != saved.configuration().protocol()) {
                    throw new IllegalArgumentException(
                            "Changing the endpoint or protocol requires a new or cleared API key");
                }
                apiKey = saved.apiKey();
            }
        }
        return new CatalogConnection(protocol, baseUrl, apiKey, Math.min(input.timeoutMillis(), 30000));
    }

    /** Lists recent immutable management events; values never include configuration or credentials. */
    public synchronized List<com.repograph.core.identity.IdentityAuditEvent> auditEvents(int limit) {
        try (var connection = connection(); var statement = connection.prepareStatement(
                "SELECT * FROM enterprise_audit WHERE action LIKE 'PROVIDER_%' ORDER BY id DESC LIMIT ?")) {
            statement.setInt(1, Math.max(1, Math.min(limit, 500)));
            try (var rows = statement.executeQuery()) {
                List<com.repograph.core.identity.IdentityAuditEvent> result = new ArrayList<>();
                while (rows.next()) result.add(new com.repograph.core.identity.IdentityAuditEvent(rows.getLong("id"),
                        rows.getString("actor_id"), rows.getString("action"), rows.getString("target_id"),
                        rows.getString("reason"), rows.getString("created_at")));
                return List.copyOf(result);
            }
        } catch (SQLException error) { throw storageFailure(); }
    }

    private void audit(Connection connection, String actor, String action, String id) throws SQLException {
        com.repograph.persistence.ManagementAuditJournal.append(connection, actor, action, id,
                "Generation provider configuration changed");
    }

    private ModelProvider find(String id) {
        return list().stream().filter(provider -> provider.id().equals(id)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Provider does not exist"));
    }

    private void initialize(boolean enabled, String url, String model) {
        try (var connection = connection(); var statement = connection.createStatement()) {
            com.repograph.persistence.ManagementAuditJournal.initialize(connection);
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS model_providers (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL,
                    base_url TEXT NOT NULL, model TEXT NOT NULL, enabled INTEGER NOT NULL,
                    selected INTEGER NOT NULL, encrypted_key TEXT NOT NULL,
                    timeout_millis INTEGER NOT NULL, max_output_tokens INTEGER NOT NULL, updated_at TEXT NOT NULL)
                    """);
            java.util.Set<String> columns = new java.util.HashSet<>();
            try (var rows = statement.executeQuery("PRAGMA table_info(model_providers)")) {
                while (rows.next()) columns.add(rows.getString("name"));
            }
            if (!columns.contains("input_usd_per_million")) {
                statement.execute("ALTER TABLE model_providers ADD COLUMN input_usd_per_million REAL");
            }
            if (!columns.contains("output_usd_per_million")) {
                statement.execute("ALTER TABLE model_providers ADD COLUMN output_usd_per_million REAL");
            }
            if (!columns.contains("input_usd_per_million") || !columns.contains("output_usd_per_million")) {
                statement.execute("UPDATE model_providers SET input_usd_per_million=0,output_usd_per_million=0 "
                        + "WHERE protocol='OLLAMA'");
            }
            statement.execute("CREATE UNIQUE INDEX IF NOT EXISTS model_provider_selected "
                    + "ON model_providers(selected) WHERE selected=1");
            try (var rows = statement.executeQuery("SELECT count(*) FROM model_providers")) {
                if (rows.next() && rows.getInt(1) > 0) return;
            }
            String timestamp = Instant.EPOCH.toString();
            boolean legacy;
            try (var rows = statement.executeQuery("SELECT name FROM sqlite_master "
                    + "WHERE type='table' AND name='llm_advisory_settings'")) { legacy = rows.next(); }
            if (legacy) {
                try (var rows = statement.executeQuery("SELECT * FROM llm_advisory_settings WHERE id='default'")) {
                    if (rows.next()) {
                        enabled = rows.getBoolean("enabled");
                        url = rows.getString("base_url");
                        model = rows.getString("model");
                        timestamp = rows.getString("updated_at");
                    }
                }
            }
            try (var insert = connection.prepareStatement("""
                    INSERT OR IGNORE INTO model_providers VALUES
                    ('legacy-ollama','Ollama','OLLAMA',?,?,?,1,'',180000,4096,?,0,0)
                    """)) {
                insert.setString(1, normalizeUrl(url));
                insert.setString(2, requiredText(model, "Model", 200));
                insert.setBoolean(3, enabled);
                insert.setString(4, timestamp);
                insert.executeUpdate();
            }
        } catch (SQLException error) { throw storageFailure(); }
    }

    private boolean hasEncryptedData() {
        return list().stream().anyMatch(ModelProvider::apiKeyConfigured);
    }

    private static ModelProvider fromRow(ResultSet row) throws SQLException {
        return new ModelProvider(row.getString("id"), row.getString("name"),
                Protocol.valueOf(row.getString("protocol")), row.getString("base_url"), row.getString("model"),
                row.getBoolean("enabled"), row.getBoolean("selected"), !row.getString("encrypted_key").isEmpty(),
                row.getInt("timeout_millis"), row.getInt("max_output_tokens"), row.getString("updated_at"),
                nullableDouble(row, "input_usd_per_million"), nullableDouble(row, "output_usd_per_million"));
    }

    private static Double nullableDouble(ResultSet row, String column) throws SQLException {
        Number value = (Number) row.getObject(column);
        return value == null ? null : value.doubleValue();
    }

    private static void validatePrices(Double input, Double output) {
        if (input == null && output == null) return;
        if (input == null || output == null || !Double.isFinite(input) || !Double.isFinite(output)
                || input < 0 || output < 0 || input > 1000000 || output > 1000000) {
            throw new IllegalArgumentException("Configure both nonnegative token prices, or leave both unknown");
        }
    }

    private Connection connection() throws SQLException {
        Connection connection = DriverManager.getConnection("jdbc:sqlite:" + database);
        try (var statement = connection.createStatement()) { statement.execute("PRAGMA busy_timeout=5000"); }
        return connection;
    }

    private static String requiredText(String value, String label, int maximum) {
        if (value == null || value.isBlank() || value.trim().length() > maximum
                || value.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException(label + " is missing or invalid");
        }
        return value.trim();
    }

    private static String normalizeUrl(String value) {
        String candidate = requiredText(value, "Base URL", 500);
        try {
            URI uri = URI.create(candidate);
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null || uri.getPort() == 0 || uri.getPort() > 65535
                    || uri.getUserInfo() != null || uri.getQuery() != null
                    || uri.getFragment() != null) throw new IllegalArgumentException();
            while (candidate.endsWith("/")) candidate = candidate.substring(0, candidate.length() - 1);
            return candidate;
        } catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException("Base URL must be HTTP(S), without credentials, query or fragment");
        }
    }

    private static IllegalStateException storageFailure() {
        return new IllegalStateException("Cannot access model provider configuration");
    }

    /** Write-only credential request. Empty keys preserve existing credentials; clear requires an explicit flag. */
    public record ProviderInput(String name, String protocol, String baseUrl, String model, boolean enabled,
                                @com.fasterxml.jackson.annotation.JsonProperty(access = com.fasterxml.jackson.annotation.JsonProperty.Access.WRITE_ONLY)
                                String apiKey, boolean clearApiKey, int timeoutMillis, int maxOutputTokens,
                                Double inputUsdPerMillionTokens, Double outputUsdPerMillionTokens) {
        /** Legacy/local construction; remote protocols have unknown prices until explicitly configured. */
        public ProviderInput(String name, String protocol, String baseUrl, String model, boolean enabled,
                             String apiKey, boolean clearApiKey, int timeoutMillis, int maxOutputTokens) {
            this(name, protocol, baseUrl, model, enabled, apiKey, clearApiKey, timeoutMillis, maxOutputTokens,
                    "OLLAMA".equals(protocol) ? 0.0 : null, "OLLAMA".equals(protocol) ? 0.0 : null);
        }
        @Override public String toString() { return "ProviderInput[credentials=REDACTED]"; }
    }

    /** Internal immutable request snapshot. Serialization is intentionally prohibited for credentials. */
    public record ResolvedProvider(ModelProvider configuration,
                                   @com.fasterxml.jackson.annotation.JsonIgnore String apiKey) {
        @Override public String toString() { return "ResolvedProvider[id=" + configuration.id() + ", key=REDACTED]"; }
    }

    /** Write-only discovery draft; no name, model or saved profile is required. */
    public record CatalogInput(String providerId, String protocol, String baseUrl,
                               @com.fasterxml.jackson.annotation.JsonProperty(
                                       access = com.fasterxml.jackson.annotation.JsonProperty.Access.WRITE_ONLY)
                               String apiKey, boolean clearApiKey, int timeoutMillis) {
        @Override public String toString() { return "CatalogInput[credentials=REDACTED]"; }
    }

    /** Internal immutable discovery connection with a thirty-second maximum deadline. */
    public record CatalogConnection(Protocol protocol, String baseUrl,
                                     @com.fasterxml.jackson.annotation.JsonIgnore String apiKey, int timeoutMillis) {
        @Override public String toString() { return "CatalogConnection[credentials=REDACTED]"; }
    }
}
