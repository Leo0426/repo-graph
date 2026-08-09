package com.repograph.advisory;

import com.repograph.core.advisory.LlmAdvisorySettings;
import com.repograph.core.advisory.LlmAdvisorySettingsService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;

/**
 * 页面可修改的 LLM 辅助复核设置 SQLite 存储。
 *
 * @author leolu
 */
@Service
public class LlmAdvisorySettingsStore implements LlmAdvisorySettingsService {

    private static final String SETTINGS_ID = "default";
    private static final String PROVIDER = "OLLAMA";

    private final String dbPath;

    /**
     * 创建运行时设置存储；数据库尚无页面设置时使用 YAML 值初始化。
     *
     * @param dbPath           SQLite 数据库路径
     * @param configuredEnabled YAML 初始开关
     * @param configuredBaseUrl YAML 初始 Ollama 地址
     * @param configuredModel   YAML 初始模型
     */
    public LlmAdvisorySettingsStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath,
            @Value("${repograph.advisory.enabled}") boolean configuredEnabled,
            @Value("${repograph.advisory.ollama.base-url}") String configuredBaseUrl,
            @Value("${repograph.advisory.ollama.model}") String configuredModel) {
        this.dbPath = dbPath;
        initTable();
        insertDefaults(configuredEnabled, configuredBaseUrl, configuredModel);
    }

    @Override
    public LlmAdvisorySettings current() {
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT * FROM llm_advisory_settings WHERE id = ?")) {
            statement.setString(1, SETTINGS_ID);
            try (ResultSet row = statement.executeQuery()) {
                if (!row.next()) {
                    throw new IllegalStateException("LLM advisory settings are not initialized");
                }
                return fromRow(row);
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to load LLM advisory settings", e);
        }
    }

    @Override
    public LlmAdvisorySettings update(
            boolean enabled, String baseUrl, String model, String updatedAt) {
        String normalizedUrl = OllamaEndpointValidator.normalizeBaseUrl(baseUrl);
        String normalizedModel = OllamaEndpointValidator.normalizeModel(model);
        Instant.parse(updatedAt);
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement("""
                     UPDATE llm_advisory_settings
                     SET enabled = ?, provider = ?, base_url = ?, model = ?, updated_at = ?
                     WHERE id = ?
                     """)) {
            statement.setInt(1, enabled ? 1 : 0);
            statement.setString(2, PROVIDER);
            statement.setString(3, normalizedUrl);
            statement.setString(4, normalizedModel);
            statement.setString(5, updatedAt);
            statement.setString(6, SETTINGS_ID);
            if (statement.executeUpdate() != 1) {
                throw new IllegalStateException("LLM advisory settings are not initialized");
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to update LLM advisory settings", e);
        }
        return current();
    }

    private void initTable() {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS llm_advisory_settings (
                        id         TEXT PRIMARY KEY,
                        enabled    INTEGER NOT NULL,
                        provider   TEXT NOT NULL,
                        base_url   TEXT NOT NULL,
                        model      TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to initialize LLM advisory settings", e);
        }
    }

    private void insertDefaults(boolean enabled, String baseUrl, String model) {
        String normalizedUrl = OllamaEndpointValidator.normalizeBaseUrl(baseUrl);
        String normalizedModel = OllamaEndpointValidator.normalizeModel(model);
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement("""
                     INSERT OR IGNORE INTO llm_advisory_settings
                         (id, enabled, provider, base_url, model, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?)
                     """)) {
            statement.setString(1, SETTINGS_ID);
            statement.setInt(2, enabled ? 1 : 0);
            statement.setString(3, PROVIDER);
            statement.setString(4, normalizedUrl);
            statement.setString(5, normalizedModel);
            statement.setString(6, Instant.EPOCH.toString());
            statement.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to initialize LLM advisory defaults", e);
        }
    }

    private static LlmAdvisorySettings fromRow(ResultSet row) throws SQLException {
        return new LlmAdvisorySettings(
                row.getInt("enabled") == 1,
                row.getString("provider"),
                row.getString("base_url"),
                row.getString("model"),
                row.getString("updated_at"));
    }

    private Connection connection() throws SQLException {
        return DriverManager.getConnection("jdbc:sqlite:" + dbPath);
    }

}
