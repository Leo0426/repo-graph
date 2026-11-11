package com.repograph.identity;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.identity.Account;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Session authentication, CSRF protection and fail-closed administrative authorization.
 * Project-specific rules are added explicitly; unclassified APIs stay administrator-only.
 * @author leolu
 */
@Configuration
@EnableWebSecurity
public class IdentitySecurityConfiguration {
    /** Provides only directory-backed authentication; suppresses Boot's generated fallback account. */
    @Bean
    public AuthenticationProvider identityAuthenticationProvider(EnterpriseDirectory directory) {
        return new AuthenticationProvider() {
            @Override
            public Authentication authenticate(Authentication authentication) {
                try {
                    Account account = directory.authenticate(authentication.getName(),
                            String.valueOf(authentication.getCredentials()));
                    return UsernamePasswordAuthenticationToken.authenticated(account, null,
                            List.of(new SimpleGrantedAuthority("ROLE_" + account.role())));
                } catch (IdentityException failure) {
                    throw new BadCredentialsException("Invalid credentials or account is not approved");
                }
            }

            @Override
            public boolean supports(Class<?> type) {
                return UsernamePasswordAuthenticationToken.class.isAssignableFrom(type);
            }
        };
    }

    /** Builds the browser/API filter chain; authorization never depends on client-side role checks. */
    @Bean
    public SecurityFilterChain identitySecurity(HttpSecurity http, EnterpriseDirectory directory,
                                                ObjectMapper json, AuthenticationProvider provider,
            @org.springframework.beans.factory.annotation.Value("${repograph.security.login-attempts-per-window:30}") int logins,
            @org.springframework.beans.factory.annotation.Value("${repograph.security.registrations-per-window:5}") int registrations,
            @org.springframework.beans.factory.annotation.Value("${repograph.security.auth-window-seconds:60}") int windowSeconds)
            throws Exception {
        http.authenticationProvider(provider)
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/login", "/css/**", "/js/**", "/vendor/**", "/favicon.ico", "/error")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/img/repograph-mark.svg").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/auth/csrf").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/register", "/api/v1/auth/login").permitAll()
                        .requestMatchers("/api/v1/auth/**").authenticated()
                        .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().authenticated())
                .formLogin(login -> login.loginPage("/login").loginProcessingUrl("/api/v1/auth/login")
                        .successHandler((request, response, authentication) ->
                                respond(json, response, 200, authentication.getPrincipal()))
                        .failureHandler((request, response, failure) ->
                                respond(json, response, 401, Map.of("error", "Invalid credentials or approval pending"))))
                .logout(logout -> logout.logoutUrl("/api/v1/auth/logout")
                        .deleteCookies("JSESSIONID").logoutSuccessHandler((request, response, authentication) ->
                                respond(json, response, 200, Map.of("status", "logged_out"))))
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, failure) -> {
                            if (request.getRequestURI().startsWith("/api/")) {
                                respond(json, response, 401, Map.of("error", "Authentication required"));
                            } else response.sendRedirect("/login");
                        })
                        .accessDeniedHandler((request, response, failure) ->
                                respond(json, response, 403, Map.of("error", "Access denied or invalid CSRF token"))))
                .addFilterBefore(new AuthenticationRateLimitFilter(logins, registrations, windowSeconds),
                        org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(new SessionValidationFilter(directory, json), AuthorizationFilter.class);
        return http.build();
    }

    private static void respond(ObjectMapper json, HttpServletResponse response, int status, Object body)
            throws IOException {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        json.writeValue(response.getWriter(), body);
    }

    private static final class SessionValidationFilter extends OncePerRequestFilter {
        private final EnterpriseDirectory directory;
        private final ObjectMapper json;

        SessionValidationFilter(EnterpriseDirectory directory, ObjectMapper json) {
            this.directory = directory;
            this.json = json;
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            if (authentication != null && authentication.getPrincipal() instanceof Account account) {
                try {
                    directory.validateSession(account.id(), account.credentialVersion());
                } catch (IdentityException failure) {
                    SecurityContextHolder.clearContext();
                    if (request.getSession(false) != null) request.getSession(false).invalidate();
                    respond(json, response, 401, Map.of("error", "Session expired; sign in again"));
                    return;
                }
            }
            chain.doFilter(request, response);
        }
    }
}
