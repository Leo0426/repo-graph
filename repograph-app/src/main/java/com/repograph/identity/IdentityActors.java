package com.repograph.identity;

import com.repograph.core.identity.Account;
import org.springframework.security.core.context.SecurityContextHolder;

/** Server-derived actor names for existing audit records. @author leolu */
public final class IdentityActors {
    private IdentityActors() {}

    /** Uses the authenticated account for HTTP calls; preserves explicit actors for internal/non-HTTP callers. */
    public static String currentName(String internalActor) {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getPrincipal() instanceof Account account
                ? account.username() : internalActor;
    }
}
