package com.repograph.identity;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares the authoritative ownership selector for an HTTP operation. Undeclared operations are admin-only.
 * @author leolu
 */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface ProjectAccess {
    /** Authorization category; project access is the default. */
    Mode mode() default Mode.PROJECT;
    /** Name of the project selector. */
    String value() default "projectId";
    /** Source of the selector. */
    Source source() default Source.QUERY;
    /** Resource kind whose persisted project must be used; PROJECT means the selector itself is the ID. */
    Resource resource() default Resource.PROJECT;
    /** Supported ownership-bearing resources. */
    enum Resource { PROJECT, SUMMARY, VULNERABILITY, AGENT_RUN, ASSET, SCAN_TASK, SCAN_RUN,
        SNAPSHOT, REVIEW_ENTRY, SUPPRESSION }
    /** Requires a supplied projectRoot to hash to the authorized project, preventing filesystem substitution. */
    boolean verifyProjectRoot() default false;
    /** Operation access category. */
    enum Mode { PROJECT, AUTHENTICATED }
    /** Selector location, resolved by Spring's matched handler rather than raw URL parsing. */
    enum Source { QUERY, PATH, BODY }
}
