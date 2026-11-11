package com.repograph.core.identity;

/**
 * Project ownership stored separately from code graph/vector models.
 * @param projectId existing stable project identifier
 * @param ownerType PERSONAL or ORGANIZATION
 * @param ownerId account or organization identifier
 * @param updatedAt last assignment timestamp
 * @author leolu
 */
public record ProjectOwner(String projectId, String ownerType, String ownerId, String updatedAt) {
}
