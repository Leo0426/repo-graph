package com.repograph.core.identity;

/**
 * Managed organization; membership is the source of access to organization-owned projects.
 * @param id stable identifier
 * @param name administrator-managed name
 * @param active whether members may access organization resources
 * @param createdAt creation timestamp
 * @author leolu
 */
public record Organization(String id, String name, boolean active, String createdAt) {
}
