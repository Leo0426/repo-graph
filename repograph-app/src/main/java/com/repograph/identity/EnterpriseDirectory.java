package com.repograph.identity;

import com.repograph.core.identity.Account;
import com.repograph.core.identity.IdentityAuditEvent;
import com.repograph.core.identity.Organization;
import com.repograph.core.identity.ProjectOwner;
import com.repograph.persistence.SqliteDatabasePath;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Transactional account directory. All mutations validate the acting account in the same transaction.
 * Public projections exclude credentials; existing bootstrap credentials are never overwritten.
 * @author leolu
 */
public final class EnterpriseDirectory {
    private static final String ADMIN_ID = "builtin-admin";
    private final String path;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder(12);
    private final String dummyHash = passwords.encode(UUID.randomUUID().toString());

    /** Opens or initializes the account schema without changing existing account state. */
    public EnterpriseDirectory(String dbPath) {
        this.path = SqliteDatabasePath.prepare(dbPath);
        transact(connection -> {
            try (Statement statement = connection.createStatement()) {
                statement.execute("""
                        CREATE TABLE IF NOT EXISTS enterprise_accounts (
                            id TEXT PRIMARY KEY,
                            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                            display_name TEXT NOT NULL,
                            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                            password_hash TEXT NOT NULL,
                            role TEXT NOT NULL CHECK(role IN ('ADMIN','USER')),
                            status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','REJECTED','DISABLED')),
                            credential_version INTEGER NOT NULL DEFAULT 1,
                            created_at TEXT NOT NULL
                        )
                        """);
                com.repograph.persistence.ManagementAuditJournal.initialize(connection);
                statement.execute("""
                        CREATE TABLE IF NOT EXISTS enterprise_organizations (
                            id TEXT PRIMARY KEY,
                            name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                            active INTEGER NOT NULL DEFAULT 1,
                            created_at TEXT NOT NULL
                        )
                        """);
                statement.execute("""
                        CREATE TABLE IF NOT EXISTS enterprise_memberships (
                            organization_id TEXT NOT NULL REFERENCES enterprise_organizations(id),
                            account_id TEXT NOT NULL REFERENCES enterprise_accounts(id),
                            PRIMARY KEY (organization_id, account_id)
                        )
                        """);
                statement.execute("""
                        CREATE TABLE IF NOT EXISTS enterprise_project_owners (
                            project_id TEXT PRIMARY KEY,
                            owner_type TEXT NOT NULL CHECK(owner_type IN ('PERSONAL','ORGANIZATION')),
                            owner_id TEXT NOT NULL,
                            updated_at TEXT NOT NULL
                        )
                        """);
            }
            return null;
        });
    }

    /** Creates the built-in admin once. A subsequent call preserves the original password. */
    public Account bootstrapAdmin(String initialPassword) {
        return transact(connection -> {
            Account existing = find(connection, ADMIN_ID);
            if (existing != null) return existing;
            validatePassword(initialPassword);
            insertAccount(connection, ADMIN_ID, "admin", "Administrator", "admin@localhost",
                    initialPassword, "ADMIN", "ACTIVE");
            audit(connection, ADMIN_ID, "BOOTSTRAP", ADMIN_ID, "Built-in administrator initialized");
            return requireAccount(connection, ADMIN_ID);
        });
    }

    /** Registers a normal account in PENDING state; callers cannot choose role or approval status. */
    public Account register(String username, String displayName, String email, String password) {
        String login = normalizeUsername(username);
        if (login.equals("admin")) throw invalid("Reserved username");
        String name = text(displayName, "Display name", 100);
        String address = text(email, "Email", 254).toLowerCase(Locale.ROOT);
        if (!address.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw invalid("Invalid email address");
        validatePassword(password);
        return transact(connection -> {
            try (PreparedStatement query = connection.prepareStatement(
                    "SELECT id FROM enterprise_accounts WHERE username = ? OR email = ?")) {
                query.setString(1, login);
                query.setString(2, address);
                try (ResultSet row = query.executeQuery()) {
                    if (row.next()) throw new IdentityException(409, "ACCOUNT_EXISTS", "Account already registered");
                }
            }
            String id = UUID.randomUUID().toString();
            insertAccount(connection, id, login, name, address, password, "USER", "PENDING");
            audit(connection, id, "REGISTER", id, "Registration awaiting approval");
            return requireAccount(connection, id);
        });
    }

    /** Authenticates only active accounts. Disabled, pending and unknown accounts have the same public failure. */
    public Account authenticate(String username, String password) {
        if (username == null || password == null || password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw unauthenticated();
        }
        return transact(connection -> {
            try (PreparedStatement query = connection.prepareStatement(
                    "SELECT * FROM enterprise_accounts WHERE username = ?")) {
                query.setString(1, username.strip().toLowerCase(Locale.ROOT));
                try (ResultSet row = query.executeQuery()) {
                    if (!row.next()) {
                        passwords.matches(password, dummyHash);
                        throw unauthenticated();
                    }
                    boolean matches = passwords.matches(password, row.getString("password_hash"));
                    Account account = fromRow(row);
                    if (!matches || !account.status().equals("ACTIVE")) throw unauthenticated();
                    return account;
                }
            }
        });
    }

    /** Returns current account state for per-request session revalidation. */
    public Account account(String id) {
        return transact(connection -> requireAccount(connection, id));
    }

    /** Validates the persisted account status and credential version for an existing session. */
    public Account validateSession(String accountId, int credentialVersion) {
        return transact(connection -> {
            Account account = find(connection, accountId);
            if (account == null || !account.status().equals("ACTIVE")
                    || account.credentialVersion() != credentialVersion) {
                throw unauthenticated();
            }
            return account;
        });
    }

    /** Lists accounts for an active administrator. */
    public List<Account> accounts(String actorId) {
        return transact(connection -> {
            requireAdmin(connection, actorId);
            List<Account> result = new ArrayList<>();
            try (Statement query = connection.createStatement();
                 ResultSet rows = query.executeQuery("SELECT * FROM enterprise_accounts ORDER BY created_at, id")) {
                while (rows.next()) result.add(fromRow(rows));
            }
            return List.copyOf(result);
        });
    }

    /**
     * Approves/rejects pending accounts or disables/reactivates existing accounts, with an audit reason.
     * The built-in administrator cannot be disabled through this API.
     */
    public Account reviewAccount(String actorId, String targetId, String status, String reason) {
        String explanation = text(reason, "Review reason", 1000);
        if (status == null) throw invalid("Status is required");
        return transact(connection -> {
            requireAdmin(connection, actorId);
            Account target = requireAccount(connection, targetId);
            if (ADMIN_ID.equals(targetId)) throw forbidden("Built-in administrator cannot be disabled or reviewed");
            boolean allowed = switch (target.status()) {
                case "PENDING" -> Set.of("ACTIVE", "REJECTED").contains(status);
                case "ACTIVE" -> "DISABLED".equals(status);
                case "DISABLED", "REJECTED" -> "ACTIVE".equals(status);
                default -> false;
            };
            if (!allowed) throw new IdentityException(409, "INVALID_TRANSITION", "Invalid account status transition");
            try (PreparedStatement update = connection.prepareStatement("""
                    UPDATE enterprise_accounts SET status = ?, credential_version = credential_version + 1 WHERE id = ?
                    """)) {
                update.setString(1, status);
                update.setString(2, targetId);
                update.executeUpdate();
            }
            audit(connection, actorId, "ACCOUNT_" + status, targetId, explanation);
            return requireAccount(connection, targetId);
        });
    }

    /** Changes the caller's password after checking the current one and revokes old session versions. */
    public Account changePassword(String actorId, String oldPassword, String newPassword) {
        validatePassword(newPassword);
        return transact(connection -> {
            Account account = requireActive(connection, actorId);
            try (PreparedStatement query = connection.prepareStatement(
                    "SELECT password_hash FROM enterprise_accounts WHERE id = ?")) {
                query.setString(1, account.id());
                try (ResultSet row = query.executeQuery()) {
                    if (!row.next() || oldPassword == null
                            || oldPassword.getBytes(StandardCharsets.UTF_8).length > 72
                            || !passwords.matches(oldPassword, row.getString(1))) {
                        throw unauthenticated();
                    }
                }
            }
            try (PreparedStatement update = connection.prepareStatement("""
                    UPDATE enterprise_accounts SET password_hash = ?, credential_version = credential_version + 1
                    WHERE id = ?
                    """)) {
                update.setString(1, passwords.encode(newPassword));
                update.setString(2, actorId);
                update.executeUpdate();
            }
            audit(connection, actorId, "PASSWORD_CHANGED", actorId, "Account password changed");
            return requireAccount(connection, actorId);
        });
    }

    /** Creates an organization; only an active administrator may create ownership targets. */
    public Organization createOrganization(String actorId, String name) {
        String normalized = text(name, "Organization name", 100);
        return transact(connection -> {
            requireAdmin(connection, actorId);
            try (PreparedStatement query = connection.prepareStatement(
                    "SELECT id FROM enterprise_organizations WHERE name = ?")) {
                query.setString(1, normalized);
                try (ResultSet row = query.executeQuery()) {
                    if (row.next()) throw new IdentityException(409, "ORGANIZATION_EXISTS", "Organization exists");
                }
            }
            String id = UUID.randomUUID().toString();
            try (PreparedStatement insert = connection.prepareStatement(
                    "INSERT INTO enterprise_organizations (id, name, created_at) VALUES (?, ?, ?)")) {
                insert.setString(1, id);
                insert.setString(2, normalized);
                insert.setString(3, Instant.now().toString());
                insert.executeUpdate();
            }
            audit(connection, actorId, "ORGANIZATION_CREATED", id, normalized);
            return requireOrganization(connection, id);
        });
    }

    /** Renames or disables an organization without deleting memberships or project ownership. */
    public Organization updateOrganization(String actorId, String organizationId, String name, boolean active) {
        String normalized = text(name, "Organization name", 100);
        return transact(connection -> {
            requireAdmin(connection, actorId);
            requireOrganization(connection, organizationId);
            try (PreparedStatement query = connection.prepareStatement(
                    "SELECT id FROM enterprise_organizations WHERE name = ? AND id <> ?")) {
                query.setString(1, normalized);
                query.setString(2, organizationId);
                try (ResultSet row = query.executeQuery()) {
                    if (row.next()) throw new IdentityException(409, "ORGANIZATION_EXISTS", "Organization exists");
                }
            }
            try (PreparedStatement update = connection.prepareStatement(
                    "UPDATE enterprise_organizations SET name = ?, active = ? WHERE id = ?")) {
                update.setString(1, normalized);
                update.setInt(2, active ? 1 : 0);
                update.setString(3, organizationId);
                update.executeUpdate();
            }
            audit(connection, actorId, "ORGANIZATION_UPDATED", organizationId,
                    normalized + (active ? ":ACTIVE" : ":DISABLED"));
            return requireOrganization(connection, organizationId);
        });
    }

    /** Returns the most recent management events; only administrators can view the audit log. */
    public List<IdentityAuditEvent> auditEvents(String actorId, int limit) {
        return transact(connection -> {
            requireAdmin(connection, actorId);
            List<IdentityAuditEvent> result = new ArrayList<>();
            try (PreparedStatement query = connection.prepareStatement(
                    "SELECT * FROM enterprise_audit ORDER BY id DESC LIMIT ?")) {
                query.setInt(1, Math.max(1, Math.min(limit, 500)));
                try (ResultSet row = query.executeQuery()) {
                    while (row.next()) {
                        result.add(new IdentityAuditEvent(row.getLong("id"), row.getString("actor_id"),
                                row.getString("action"), row.getString("target_id"), row.getString("reason"),
                                row.getString("created_at")));
                    }
                }
            }
            return List.copyOf(result);
        });
    }

    /** Lists all organizations for administrators or active memberships for ordinary accounts. */
    public List<Organization> organizations(String actorId) {
        return transact(connection -> {
            Account actor = requireActive(connection, actorId);
            boolean admin = actor.role().equals("ADMIN");
            String sql = "SELECT o.* FROM enterprise_organizations o"
                    + (admin ? "" : " JOIN enterprise_memberships m ON m.organization_id = o.id"
                    + " WHERE m.account_id = ? AND o.active = 1") + " ORDER BY o.name";
            List<Organization> result = new ArrayList<>();
            try (PreparedStatement query = connection.prepareStatement(sql)) {
                if (!admin) query.setString(1, actorId);
                try (ResultSet row = query.executeQuery()) {
                    while (row.next()) result.add(organizationFromRow(row));
                }
            }
            return List.copyOf(result);
        });
    }

    /** Adds or removes an approved account's organization membership immediately. */
    public void setMembership(String actorId, String organizationId, String accountId, boolean member) {
        transact(connection -> {
            requireAdmin(connection, actorId);
            Organization organization = requireOrganization(connection, organizationId);
            requireAccount(connection, accountId);
            if (member) {
                requireActive(connection, accountId);
                if (!organization.active()) throw invalid("Organization is disabled");
            }
            String sql = member
                    ? "INSERT OR IGNORE INTO enterprise_memberships (organization_id, account_id) VALUES (?, ?)"
                    : "DELETE FROM enterprise_memberships WHERE organization_id = ? AND account_id = ?";
            try (PreparedStatement update = connection.prepareStatement(sql)) {
                update.setString(1, organizationId);
                update.setString(2, accountId);
                if (update.executeUpdate() > 0) {
                    audit(connection, actorId, member ? "MEMBER_ADDED" : "MEMBER_REMOVED",
                            organizationId, accountId);
                }
            }
            return null;
        });
    }

    /** Returns organization members for an administrator, including disabled accounts. */
    public List<Account> members(String actorId, String organizationId) {
        return transact(connection -> {
            requireAdmin(connection, actorId);
            requireOrganization(connection, organizationId);
            List<Account> result = new ArrayList<>();
            try (PreparedStatement query = connection.prepareStatement("""
                    SELECT a.* FROM enterprise_accounts a JOIN enterprise_memberships m ON m.account_id = a.id
                    WHERE m.organization_id = ? ORDER BY a.username
                    """)) {
                query.setString(1, organizationId);
                try (ResultSet row = query.executeQuery()) {
                    while (row.next()) result.add(fromRow(row));
                }
            }
            return List.copyOf(result);
        });
    }

    /** Assigns or transfers a project to an active account or organization, preserving the project's ID. */
    public ProjectOwner assignProject(String actorId, String projectId, String ownerType, String ownerId) {
        validateProjectId(projectId);
        return transact(connection -> {
            requireAdmin(connection, actorId);
            if ("PERSONAL".equals(ownerType)) requireActive(connection, ownerId);
            else if ("ORGANIZATION".equals(ownerType)) {
                if (!requireOrganization(connection, ownerId).active()) throw invalid("Organization is disabled");
            } else throw invalid("Owner type must be PERSONAL or ORGANIZATION");
            String now = Instant.now().toString();
            try (PreparedStatement update = connection.prepareStatement("""
                    INSERT INTO enterprise_project_owners (project_id, owner_type, owner_id, updated_at)
                    VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET
                    owner_type = excluded.owner_type, owner_id = excluded.owner_id, updated_at = excluded.updated_at
                    """)) {
                update.setString(1, projectId);
                update.setString(2, ownerType);
                update.setString(3, ownerId);
                update.setString(4, now);
                update.executeUpdate();
            }
            audit(connection, actorId, "PROJECT_ASSIGNED", projectId, ownerType + ":" + ownerId);
            return new ProjectOwner(projectId, ownerType, ownerId, now);
        });
    }

    /** Checks project access from current ownership and membership; unassigned projects are admin-only. */
    public boolean canAccessProject(String actorId, String projectId) {
        if (projectId == null || projectId.isBlank()) return false;
        return transact(connection -> canAccessProject(connection, requireActive(connection, actorId), projectId));
    }

    /** Resolves current access for a server-provided candidate set in one directory transaction. */
    public java.util.Set<String> accessibleProjectIds(String actorId, java.util.Collection<String> candidates) {
        return transact(connection -> {
            Account actor = requireActive(connection, actorId);
            var result = new java.util.HashSet<String>();
            for (String id : candidates) {
                if (id != null && !id.isBlank() && canAccessProject(connection, actor, id)) result.add(id);
            }
            return java.util.Set.copyOf(result);
        });
    }

    /** Returns a project's binding to an authorized caller, or null for an unassigned administrator-visible project. */
    public ProjectOwner projectOwner(String actorId, String projectId) {
        return transact(connection -> {
            Account actor = requireActive(connection, actorId);
            if (!canAccessProject(connection, actor, projectId)) throw forbidden("Project access denied");
            return owner(connection, projectId);
        });
    }

    private boolean canAccessProject(Connection connection, Account actor, String projectId) throws SQLException {
        if (actor.role().equals("ADMIN")) return true;
        ProjectOwner owner = owner(connection, projectId);
        if (owner == null) return false;
        if (owner.ownerType().equals("PERSONAL")) return owner.ownerId().equals(actor.id());
        try (PreparedStatement query = connection.prepareStatement("""
                SELECT 1 FROM enterprise_memberships m JOIN enterprise_organizations o ON m.organization_id = o.id
                WHERE m.organization_id = ? AND m.account_id = ? AND o.active = 1
                """)) {
            query.setString(1, owner.ownerId());
            query.setString(2, actor.id());
            try (ResultSet row = query.executeQuery()) { return row.next(); }
        }
    }

    private ProjectOwner owner(Connection connection, String projectId) throws SQLException {
        try (PreparedStatement query = connection.prepareStatement(
                "SELECT * FROM enterprise_project_owners WHERE project_id = ?")) {
            query.setString(1, projectId);
            try (ResultSet row = query.executeQuery()) {
                return row.next() ? new ProjectOwner(row.getString("project_id"), row.getString("owner_type"),
                        row.getString("owner_id"), row.getString("updated_at")) : null;
            }
        }
    }

    private Organization requireOrganization(Connection connection, String id) throws SQLException {
        try (PreparedStatement query = connection.prepareStatement("SELECT * FROM enterprise_organizations WHERE id = ?")) {
            query.setString(1, id);
            try (ResultSet row = query.executeQuery()) {
                if (!row.next()) throw new IdentityException(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
                return organizationFromRow(row);
            }
        }
    }

    private static Organization organizationFromRow(ResultSet row) throws SQLException {
        return new Organization(row.getString("id"), row.getString("name"), row.getInt("active") == 1,
                row.getString("created_at"));
    }

    private static void validateProjectId(String projectId) {
        if (projectId == null || !projectId.matches("[a-f0-9]{12}")) throw invalid("Invalid project ID");
    }

    private void insertAccount(Connection connection, String id, String username, String displayName,
                               String email, String password, String role, String status) throws SQLException {
        try (PreparedStatement insert = connection.prepareStatement("""
                INSERT INTO enterprise_accounts
                (id, username, display_name, email, password_hash, role, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """)) {
            insert.setString(1, id);
            insert.setString(2, username);
            insert.setString(3, displayName);
            insert.setString(4, email);
            insert.setString(5, passwords.encode(password));
            insert.setString(6, role);
            insert.setString(7, status);
            insert.setString(8, Instant.now().toString());
            insert.executeUpdate();
        }
    }

    private Account find(Connection connection, String id) throws SQLException {
        try (PreparedStatement query = connection.prepareStatement("SELECT * FROM enterprise_accounts WHERE id = ?")) {
            query.setString(1, id);
            try (ResultSet row = query.executeQuery()) { return row.next() ? fromRow(row) : null; }
        }
    }

    private Account requireAccount(Connection connection, String id) throws SQLException {
        Account account = find(connection, id);
        if (account == null) throw new IdentityException(404, "ACCOUNT_NOT_FOUND", "Account not found");
        return account;
    }

    private Account requireActive(Connection connection, String id) throws SQLException {
        Account account = requireAccount(connection, id);
        if (!account.status().equals("ACTIVE")) throw forbidden("Account is not active");
        return account;
    }

    private Account requireAdmin(Connection connection, String id) throws SQLException {
        Account account = requireActive(connection, id);
        if (!account.role().equals("ADMIN")) throw forbidden("Administrator access required");
        return account;
    }

    private static Account fromRow(ResultSet row) throws SQLException {
        return new Account(row.getString("id"), row.getString("username"), row.getString("display_name"),
                row.getString("email"), row.getString("role"), row.getString("status"),
                row.getInt("credential_version"), row.getString("created_at"));
    }

    private static void audit(Connection connection, String actor, String action, String target, String reason)
            throws SQLException {
        com.repograph.persistence.ManagementAuditJournal.append(connection, actor, action, target, reason);
    }

    private synchronized <T> T transact(SqlWork<T> work) {
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + path)) {
            try (Statement statement = connection.createStatement()) {
                statement.execute("PRAGMA foreign_keys=ON");
                statement.execute("PRAGMA busy_timeout=5000");
            }
            connection.setAutoCommit(false);
            try {
                T result = work.run(connection);
                connection.commit();
                return result;
            } catch (SQLException | RuntimeException failure) {
                connection.rollback();
                throw failure;
            }
        } catch (SQLException failure) {
            throw new IllegalStateException("Enterprise directory operation failed", failure);
        }
    }

    private static String normalizeUsername(String value) {
        String username = text(value, "Username", 64).toLowerCase(Locale.ROOT);
        if (!username.matches("[a-z0-9][a-z0-9_.-]{2,63}")) throw invalid("Invalid username");
        return username;
    }

    private static String text(String value, String name, int limit) {
        if (value == null || value.isBlank() || value.strip().length() > limit) throw invalid(name + " is required");
        return value.strip();
    }

    private static void validatePassword(String value) {
        if (value == null || value.length() < 12 || value.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw invalid("Password must contain at least 12 characters and at most 72 UTF-8 bytes");
        }
    }

    private static IdentityException invalid(String message) {
        return new IdentityException(400, "INVALID_INPUT", message);
    }

    private static IdentityException forbidden(String message) {
        return new IdentityException(403, "ACCESS_DENIED", message);
    }

    private static IdentityException unauthenticated() {
        return new IdentityException(401, "INVALID_CREDENTIALS", "Invalid credentials or account is not approved");
    }

    @FunctionalInterface
    private interface SqlWork<T> { T run(Connection connection) throws SQLException; }
}
