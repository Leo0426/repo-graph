package com.repograph.asset;

import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ImportedAsset;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.Optional;

/**
 * 托管归档资产的 SQLite 注册表。
 *
 * @author leolu
 */
@Service
public class ImportedAssetStore {

    private static final Logger log = LoggerFactory.getLogger(ImportedAssetStore.class);

    private final String dbPath;

    /**
     * 创建资产注册表并初始化表结构。
     *
     * @param dbPath SQLite 数据库路径
     */
    public ImportedAssetStore(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath) {
        this.dbPath = dbPath;
        initTable();
    }

    /**
     * 保存新资产。
     *
     * @param asset 资产快照
     */
    public void save(ImportedAsset asset) {
        String sql = """
                INSERT INTO imported_assets
                    (asset_id, project_id, original_name, archive_type, project_root,
                     status, error, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)
                """;
        try (Connection conn = connection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, asset.assetId());
            ps.setString(2, asset.projectId());
            ps.setString(3, asset.originalFileName());
            ps.setString(4, asset.archiveType());
            ps.setString(5, asset.projectRoot().toString());
            ps.setString(6, asset.status().name());
            ps.setString(7, asset.error());
            ps.setString(8, asset.createdAt());
            ps.setString(9, asset.updatedAt());
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to save imported asset '" + asset.assetId() + "'", e);
        }
    }

    /**
     * 更新资产状态。
     *
     * @param assetId 资产 ID
     * @param status  新状态
     * @param error   失败摘要
     */
    public void updateStatus(String assetId, AssetStatus status, String error) {
        try (Connection conn = connection();
             PreparedStatement ps = conn.prepareStatement("""
                     UPDATE imported_assets
                     SET status = ?, error = ?, updated_at = ?
                     WHERE asset_id = ?
                     """)) {
            ps.setString(1, status.name());
            ps.setString(2, error == null ? "" : error);
            ps.setString(3, Instant.now().toString());
            ps.setString(4, assetId);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to update imported asset '" + assetId + "'", e);
        }
    }

    /**
     * 按资产 ID 查询。
     *
     * @param assetId 资产 ID
     * @return 资产快照
     */
    public Optional<ImportedAsset> findById(String assetId) {
        return findOne("SELECT * FROM imported_assets WHERE asset_id = ?", assetId);
    }

    /**
     * 按项目 ID 查询托管资产。
     *
     * @param projectId 项目 ID
     * @return 资产快照
     */
    public Optional<ImportedAsset> findByProjectId(String projectId) {
        return findOne("SELECT * FROM imported_assets WHERE project_id = ?", projectId);
    }

    /**
     * 删除资产注册记录。
     *
     * @param assetId 资产 ID
     */
    public void delete(String assetId) {
        try (Connection conn = connection();
             PreparedStatement ps = conn.prepareStatement(
                     "DELETE FROM imported_assets WHERE asset_id = ?")) {
            ps.setString(1, assetId);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to delete imported asset '" + assetId + "'", e);
        }
    }

    private Optional<ImportedAsset> findOne(String sql, String value) {
        try (Connection conn = connection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, value);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(fromRow(rs));
            }
        } catch (SQLException e) {
            log.warn("Failed to query imported asset '{}': {}", value, e.getMessage());
            return Optional.empty();
        }
    }

    private Connection connection() throws SQLException {
        return DriverManager.getConnection("jdbc:sqlite:" + dbPath);
    }

    private void initTable() {
        try (Connection conn = connection();
             Statement stmt = conn.createStatement()) {
            stmt.execute("""
                    CREATE TABLE IF NOT EXISTS imported_assets (
                        asset_id       TEXT PRIMARY KEY,
                        project_id     TEXT NOT NULL UNIQUE,
                        original_name  TEXT NOT NULL,
                        archive_type   TEXT NOT NULL,
                        project_root   TEXT NOT NULL,
                        status         TEXT NOT NULL,
                        error          TEXT NOT NULL DEFAULT '',
                        created_at     TEXT NOT NULL,
                        updated_at     TEXT NOT NULL
                    )
                    """);
            stmt.execute("""
                    CREATE INDEX IF NOT EXISTS idx_imported_assets_project
                    ON imported_assets(project_id)
                    """);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to initialize imported_assets table", e);
        }
    }

    private static ImportedAsset fromRow(ResultSet rs) throws SQLException {
        return new ImportedAsset(
                rs.getString("asset_id"),
                rs.getString("project_id"),
                rs.getString("original_name"),
                rs.getString("archive_type"),
                Path.of(rs.getString("project_root")),
                AssetStatus.valueOf(rs.getString("status")),
                rs.getString("error"),
                rs.getString("created_at"),
                rs.getString("updated_at"),
                null);
    }
}
