package com.repograph.identity;

/**
 * Safe identity error carrying a stable code and intended HTTP status, without credentials.
 * @author leolu
 */
public final class IdentityException extends RuntimeException {
    private static final long serialVersionUID = 1L;
    private final int status;
    private final String code;

    /** Creates a public, credential-free failure. */
    public IdentityException(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    /** Returns the HTTP status for transport adapters. */
    public int status() { return status; }

    /** Returns the stable failure code. */
    public String code() { return code; }
}
