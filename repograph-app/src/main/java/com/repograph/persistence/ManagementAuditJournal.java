package com.repograph.persistence;

import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;

/** Shared management journal, appended inside the caller's state-change transaction. @author leolu */
public final class ManagementAuditJournal {
    private ManagementAuditJournal() { }

    /** Creates the common journal without changing existing identities or events. */
    public static void initialize(Connection connection) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS enterprise_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, action TEXT NOT NULL,
                    target_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL)
                    """);
        }
    }

    /** Appends a secret-free event; the owning service validates authorization and commits the transaction. */
    public static void append(Connection connection, String actor, String action, String target, String reason)
            throws SQLException {
        try (var statement = connection.prepareStatement("""
                INSERT INTO enterprise_audit (actor_id,action,target_id,reason,created_at) VALUES (?,?,?,?,?)
                """)) {
            statement.setString(1, actor);
            statement.setString(2, action);
            statement.setString(3, target);
            statement.setString(4, reason);
            statement.setString(5, Instant.now().toString());
            statement.executeUpdate();
        }
    }
}
