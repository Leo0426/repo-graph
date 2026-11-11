package com.repograph.api;

import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcBuilderCustomizer;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * Existing controller contract tests exercise authenticated admin requests with CSRF, keeping filters enabled.
 * Real account/session/ownership behavior is separately verified by identity HTTP integration tests.
 * @author leolu
 */
@TestConfiguration
public class ControllerTestSecurity {
    /** Supplies authenticated default requests instead of bypassing Spring Security filters. */
    @Bean
    public MockMvcBuilderCustomizer authenticatedContractRequests() {
        return builder -> builder.defaultRequest(get("/").with(user("contract-admin").roles("ADMIN")).with(csrf()));
    }
}
