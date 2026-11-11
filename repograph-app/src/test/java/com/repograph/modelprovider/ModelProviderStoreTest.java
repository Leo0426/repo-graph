package com.repograph.modelprovider;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/** Persistent provider configuration and secret boundary tests. @author leolu */
class ModelProviderStoreTest {
    @TempDir Path temporary;

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"OPENAI", "OPENAI_COMPATIBLE"})
    void customProviderSurvivesRestartWithoutExposingOrLosingItsSecret(String protocol) throws Exception {
        String database = temporary.resolve("index.db").toString();
        var store = new ModelProviderStore(database, "", false, "http://localhost:11434", "local-model");
        var saved = store.save(null, new ModelProviderStore.ProviderInput(
                "Company gateway", protocol, "https://models.example.test/v1/", "team-model", true,
                "private-api-key-123", false, 30000, 2048));
        store.select(saved.id());
        assertThat(store.current().id()).isEqualTo(saved.id());
        assertThat(store.current().baseUrl()).isEqualTo("https://models.example.test/v1");
        assertThat(new ObjectMapper().writeValueAsString(store.list())).doesNotContain("private-api-key-123");
        assertThat(new String(Files.readAllBytes(Path.of(database)), java.nio.charset.StandardCharsets.ISO_8859_1))
                .doesNotContain("private-api-key-123");
        var reopened = new ModelProviderStore(database, "", false, "http://localhost:11434", "ignored-default");
        assertThat(reopened.current().protocol().name()).isEqualTo(protocol);
        assertThat(reopened.resolveCurrent().apiKey()).isEqualTo("private-api-key-123");
        reopened.save(saved.id(), new ModelProviderStore.ProviderInput(
                "Renamed", protocol, "https://models.example.test/v1", "new-model", true,
                null, false, 15000, 4096));
        assertThat(reopened.resolveCurrent().apiKey()).isEqualTo("private-api-key-123");
        assertThat(reopened.resolveCurrent().toString()).doesNotContain("private-api-key-123");
        reopened.save(saved.id(), new ModelProviderStore.ProviderInput(
                "Renamed", protocol, "https://models.example.test/v1", "new-model", true,
                null, true, 15000, 4096));
        assertThat(reopened.resolveCurrent().apiKey()).isEmpty();
    }
    @Test
    void legacySettingsReadTheSameSelectedProviderAndCannotOverwriteAnotherProtocol() {
        String database = temporary.resolve("legacy.db").toString();
        var providers = new ModelProviderStore(database, "", false, "http://localhost:11434", "local-model");
        var anthropic = providers.save(null, new ModelProviderStore.ProviderInput(
                "Claude gateway", "ANTHROPIC", "https://claude.example.test/v1", "claude-test", true,
                "test-key", false, 25000, 4096));
        providers.select(anthropic.id());
        var legacy = new com.repograph.advisory.LlmAdvisorySettingsStore(
                database, false, "http://localhost:11434", "ignored-default");
        assertThat(legacy.current().provider()).isEqualTo("ANTHROPIC");
        assertThat(legacy.current().model()).isEqualTo("claude-test");
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> legacy.update(
                true, "http://localhost:11434", "old-ui", "2026-11-10T00:00:00Z"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(providers.current().id()).isEqualTo(anthropic.id());
    }
    @Test
    void migratesSavedLegacySettingsOnceAndKeepsProviderSelectionAcrossRestarts() throws Exception {
        String database = temporary.resolve("migration.db").toString();
        try (var connection = java.sql.DriverManager.getConnection("jdbc:sqlite:" + database);
             var statement = connection.createStatement()) {
            statement.execute("CREATE TABLE llm_advisory_settings (id TEXT, enabled INTEGER, provider TEXT, "
                    + "base_url TEXT, model TEXT, updated_at TEXT)");
            statement.execute("INSERT INTO llm_advisory_settings VALUES ('default',1,'OLLAMA',"
                    + "'http://saved.example.test:11434','saved-model','2026-08-09T09:00:00Z')");
        }
        var store = new ModelProviderStore(database, "", false, "http://localhost:11434", "yaml-model");
        assertThat(store.current().model()).isEqualTo("saved-model");
        assertThat(store.current().enabled()).isTrue();
        assertThat(store.current().updatedAt()).isEqualTo("2026-08-09T09:00:00Z");
        var saved = store.save(null, new ModelProviderStore.ProviderInput("Replacement", "ANTHROPIC",
                "https://models.example.test/v1", "new-model", true, "key", false, 30000, 2048));
        store.select(saved.id());
        store.delete("legacy-ollama");
        var reopened = new ModelProviderStore(database, "", false, "http://localhost:11434", "yaml-model");
        assertThat(reopened.list()).hasSize(1);
        assertThat(reopened.current().id()).isEqualTo(saved.id());
        Files.delete(temporary.resolve("provider-encryption-key"));
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> new ModelProviderStore(
                database, "", false, "http://localhost:11434", "yaml-model"))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("encryption key");
        assertThat(temporary.resolve("provider-encryption-key")).doesNotExist();
    }
    @Test
    void configuredTokenPricesPersistAndUnknownPricesRemainExplicit() {
        String database = temporary.resolve("prices.db").toString();
        var store = new ModelProviderStore(database, "", false, "http://localhost:11434", "local-model");
        var unknown = store.save(null, new ModelProviderStore.ProviderInput("Unpriced", "OPENAI",
                "https://models.example.test/v1", "team-model", true, "", false, 30000, 4096));
        assertThat(unknown.inputUsdPerMillionTokens()).isNull();
        var priced = store.save(unknown.id(), new ModelProviderStore.ProviderInput("Priced", "OPENAI",
                "https://models.example.test/v1", "team-model", true, "", false, 30000, 4096, 2.0, 8.0));
        store.select(priced.id());
        var reopened = new ModelProviderStore(database, "", false, "http://localhost:11434", "ignored");
        assertThat(reopened.current().inputUsdPerMillionTokens()).isEqualTo(2.0);
        assertThat(reopened.current().outputUsdPerMillionTokens()).isEqualTo(8.0);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> store.save(priced.id(),
                new ModelProviderStore.ProviderInput("Invalid", "OPENAI", "https://models.example.test/v1",
                        "team-model", true, "", false, 30000, 4096, -1.0, 8.0)))
                .isInstanceOf(IllegalArgumentException.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> store.save(priced.id(),
                new ModelProviderStore.ProviderInput("Invalid", "OPENAI", "https://models.example.test/v1",
                        "team-model", true, "", false, 30000, 4096, null, 8.0)))
                .isInstanceOf(IllegalArgumentException.class);
    }
    @Test
    void providerMutationsRetainAdministratorAuditWithoutSecrets() throws Exception {
        var store = new ModelProviderStore(temporary.resolve("audit.db").toString(), "", false,
                "http://localhost:11434", "local-model");
        var saved = store.save(null, new ModelProviderStore.ProviderInput("Audited", "OPENAI",
                "https://models.example.test/v1", "team-model", true, "audit-private-key", false, 30000, 4096),
                "2026-11-10T00:00:00Z", "admin-actor");
        store.select(saved.id(), "admin-actor");
        assertThat(store.auditEvents(10)).extracting(com.repograph.core.identity.IdentityAuditEvent::action)
                .contains("PROVIDER_CREATED", "PROVIDER_SELECTED");
        assertThat(store.auditEvents(10)).allMatch(event -> event.actorId().equals("admin-actor"));
        assertThat(new ObjectMapper().writeValueAsString(store.auditEvents(10))).doesNotContain("audit-private-key");
    }
    @Test
    void endpointChangesRequireExplicitCredentialReplacementAndWrongMasterKeyFailsClosed() throws Exception {
        String database = temporary.resolve("credentials.db").toString();
        var store = new ModelProviderStore(database, "", false, "http://localhost:11434", "local-model");
        var saved = store.save(null, new ModelProviderStore.ProviderInput("Company", "OPENAI",
                "https://original.example.test/v1", "model", true, "original-secret", false, 30000, 4096));
        int before = store.auditEvents(100).size();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> store.save(saved.id(),
                new ModelProviderStore.ProviderInput("Company", "OPENAI", "https://replacement.example.test/v1",
                        "model", true, null, false, 30000, 4096)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("API key");
        assertThat(store.auditEvents(100)).hasSize(before);
        assertThat(store.resolve(saved.id()).configuration().baseUrl()).isEqualTo("https://original.example.test/v1");
        assertThat(store.resolve(saved.id()).apiKey()).isEqualTo("original-secret");
        store.save(saved.id(), new ModelProviderStore.ProviderInput("Company", "ANTHROPIC",
                "https://replacement.example.test/v1", "model", true, "replacement-secret", false, 30000, 4096));
        assertThat(store.resolve(saved.id()).apiKey()).isEqualTo("replacement-secret");
        assertThat(java.nio.file.Files.getPosixFilePermissions(temporary.resolve("provider-encryption-key")))
                .isEqualTo(java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        String wrongKey = java.util.Base64.getEncoder().encodeToString(new byte[32]);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> new ModelProviderStore(database, wrongKey,
                false, "http://localhost:11434", "local-model"))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("decrypt");
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"file:///tmp/model", "https://user:secret@example.test/v1",
            "https://example.test/v1?key=secret", "https://example.test:999999/v1", "https://example.test:0/v1"})
    void rejectsInvalidProviderEndpoints(String endpoint) {
        var store = new ModelProviderStore(temporary.resolve("invalid.db").toString(), "", false,
                "http://localhost:11434", "local-model");
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> store.save(null, new ModelProviderStore.ProviderInput(
                "Invalid", "OPENAI", endpoint, "model", true, "", false, 30000, 4096)))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
