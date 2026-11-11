package com.repograph.core.identity;

/**
 * Append-only management event, excluding password and API-key material.
 * @param id monotonic event identifier
 * @param actorId acting account
 * @param action stable action code
 * @param targetId affected account, organization, project or model provider
 * @param reason public management reason or ownership reference
 * @param createdAt event timestamp
 * @author leolu
 */
public record IdentityAuditEvent(long id, String actorId, String action, String targetId,
                                 String reason, String createdAt) {
}
