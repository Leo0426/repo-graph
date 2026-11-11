package com.repograph.core.identity;

/**
 * Public account projection; password material never crosses this boundary.
 *
 * @param id stable account identifier
 * @param username normalized login name
 * @param displayName human-readable name
 * @param email contact address
 * @param role ADMIN or USER
 * @param status PENDING, ACTIVE, REJECTED or DISABLED
 * @param credentialVersion incremented when credentials or access status change
 * @param createdAt registration timestamp
 * @author leolu
 */
public record Account(String id, String username, String displayName, String email,
                      String role, String status, int credentialVersion, String createdAt) {
}
