package com.repograph.identity;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.api.AccountAdminController;
import com.repograph.api.AuthController;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** HTTP authentication and approval using the real security filter chain and SQLite. @author leolu */
@SpringBootTest(classes = IdentityHttpTest.Application.class)
@AutoConfigureMockMvc
class IdentityHttpTest {
    @TempDir static Path directory;
    @Autowired MockMvc http;
    @Autowired ObjectMapper json;
    @Autowired EnterpriseDirectory applicationDirectory;

    @org.springframework.context.annotation.Configuration
    @org.springframework.boot.test.context.TestComponent
    @EnableAutoConfiguration
    @Import({IdentitySecurityConfiguration.class, AuthController.class, AccountAdminController.class})
    static class Application {
        @Bean EnterpriseDirectory directory() {
            var result = new EnterpriseDirectory(directory.resolve("http.db").toString());
            result.bootstrapAdmin("Initial-admin-password-2026");
            return result;
        }
    }

    @Test
    void anonymousLoginBrandImageIsServedWithoutAuthentication() throws Exception {
        var response = http.perform(get("/img/repograph-mark.svg"))
                .andExpect(status().isOk()).andReturn().getResponse();
        assertThat(response.getContentType()).startsWith("image/svg+xml");
        assertThat(response.getContentAsString()).contains("<svg");
        http.perform(get("/api/v1/admin/accounts")).andExpect(status().isUnauthorized());
    }

    @Test
    void registrationApprovalLoginAndAdministrativeAuthorizationWorkThroughHttp() throws Exception {
        http.perform(get("/api/v1/admin/accounts")).andExpect(status().isUnauthorized());
        var registration = http.perform(post("/api/v1/auth/register").with(csrf())
                .contentType("application/json").content("""
                        {"username":"alice","displayName":"Alice","email":"alice@example.test",
                         "password":"Alice-password-2026","role":"ADMIN","status":"ACTIVE"}
                        """)).andExpect(status().isCreated()).andReturn();
        var account = json.readTree(registration.getResponse().getContentAsString());
        assertThat(account.path("role").asText()).isEqualTo("USER");
        assertThat(account.path("status").asText()).isEqualTo("PENDING");
        http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "alice")
                .param("password", "Alice-password-2026")).andExpect(status().isUnauthorized());
        var login = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "admin")
                .param("password", "Initial-admin-password-2026")).andExpect(status().isOk()).andReturn();
        var adminSession = (MockHttpSession) login.getRequest().getSession(false);
        http.perform(post("/api/v1/admin/accounts/" + account.path("id").asText() + "/review")
                .session(adminSession).with(csrf()).contentType("application/json")
                .content("{\"status\":\"ACTIVE\",\"reason\":\"Verified employee\"}"))
                .andExpect(status().isOk());
        var approvedLogin = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "alice")
                .param("password", "Alice-password-2026")).andExpect(status().isOk()).andReturn();
        var userSession = (MockHttpSession) approvedLogin.getRequest().getSession(false);
        http.perform(get("/api/v1/auth/me").session(userSession)).andExpect(status().isOk());
        http.perform(get("/api/v1/admin/accounts").session(userSession)).andExpect(status().isForbidden());
        http.perform(get("/api/v1/admin/accounts").session(adminSession)).andExpect(status().isOk());
    }
    @Test
    void csrfTokensAreRequiredAndDisablingAnAccountRevokesAnExistingHttpSession() throws Exception {
        http.perform(post("/api/v1/auth/register").contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
        var tokenResult = http.perform(get("/api/v1/auth/csrf")).andExpect(status().isOk()).andReturn();
        var token = json.readTree(tokenResult.getResponse().getContentAsString());
        var anonymousSession = (MockHttpSession) tokenResult.getRequest().getSession(false);
        String anonymousSessionId = anonymousSession.getId();
        var adminLogin = http.perform(post("/api/v1/auth/login").session(anonymousSession)
                .header(token.path("headerName").asText(), token.path("token").asText())
                .param("username", "admin").param("password", "Initial-admin-password-2026"))
                .andExpect(status().isOk()).andReturn();
        var adminSession = (MockHttpSession) adminLogin.getRequest().getSession(false);
        assertThat(adminSession.getId()).isNotEqualTo(anonymousSessionId);
        var directory = applicationDirectory;
        var user = directory.register("revoked", "Revoked user", "revoked@example.test", "Revoked-password-2026");
        directory.reviewAccount("builtin-admin", user.id(), "ACTIVE", "Approved");
        var login = http.perform(post("/api/v1/auth/login").with(csrf()).param("username", "revoked")
                .param("password", "Revoked-password-2026")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) login.getRequest().getSession(false);
        directory.reviewAccount("builtin-admin", user.id(), "DISABLED", "Access removed");
        http.perform(get("/api/v1/auth/me").session(session)).andExpect(status().isUnauthorized());
        http.perform(post("/api/v1/auth/logout").session(adminSession).with(csrf())).andExpect(status().isOk());
        assertThat(adminSession.isInvalid()).isTrue();
    }

    @Test
    void realSecurityChainThrottlesRepeatedLoginAttemptsWithoutBlockingCsrfBootstrap() throws Exception {
        for (int attempt = 0; attempt < 30; attempt++) {
            http.perform(post("/api/v1/auth/login").with(csrf())
                    .with(request -> { request.setRemoteAddr("192.0.2.77"); return request; })
                    .param("username", "admin").param("password", "x".repeat(73)))
                    .andExpect(status().isUnauthorized());
        }
        http.perform(post("/api/v1/auth/login").with(csrf())
                .with(request -> { request.setRemoteAddr("192.0.2.77"); return request; })
                .header("X-Forwarded-For", "203.0.113.2")
                .param("username", "admin").param("password", "x".repeat(73)))
                .andExpect(status().isTooManyRequests())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header().exists("Retry-After"));
        http.perform(get("/api/v1/auth/csrf")
                .with(request -> { request.setRemoteAddr("192.0.2.77"); return request; }))
                .andExpect(status().isOk());
    }

}
