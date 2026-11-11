package com.repograph.identity;

import com.repograph.core.identity.Account;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Map;

/**
 * Enforces declared project ownership before controllers execute. Unknown operations remain admin-only.
 * @author leolu
 */
@Configuration
public class ProjectAccessConfiguration implements WebMvcConfigurer {
    private final EnterpriseDirectory directory;
    private final ResourceProjectLookup resources;

    /** Creates the HTTP ownership guard. */
    public ProjectAccessConfiguration(EnterpriseDirectory directory, ResourceProjectLookup resources) {
        this.directory = directory;
        this.resources = resources;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                if (!(handler instanceof HandlerMethod method)) return true;
                if (method.getBeanType().equals(com.repograph.api.AuthController.class)) return true;
                Account account = currentAccount();
                if (account.role().equals("ADMIN")) return true;
                ProjectAccess access = method.getMethodAnnotation(ProjectAccess.class);
                if (access == null) access = method.getBeanType().getAnnotation(ProjectAccess.class);
                if (access == null) throw denied();
                if (access.mode() == ProjectAccess.Mode.AUTHENTICATED) return true;
                if (access.source() == ProjectAccess.Source.BODY) return true; // ProjectBodyAccess validates before invocation.
                String projectId;
                if (access.source() == ProjectAccess.Source.PATH) {
                    Object variables = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
                    projectId = variables instanceof Map<?, ?> values ? (String) values.get(access.value()) : null;
                } else {
                    String[] values = request.getParameterValues(access.value());
                    projectId = values != null && values.length == 1 ? values[0] : null;
                }
                if (!directory.canAccessProject(account.id(), resources.project(access.resource(), projectId))) throw denied();
                if (access.verifyProjectRoot()) {
                    String[] roots = request.getParameterValues("projectRoot");
                    if (roots == null || roots.length != 1 || roots[0].isBlank()) throw denied();
                    try {
                        String rootId = com.repograph.core.util.ProjectIdUtil.generateProjectId(java.nio.file.Path.of(roots[0]));
                        if (!rootId.equals(projectId)) throw denied();
                    } catch (java.nio.file.InvalidPathException failure) { throw denied(); }
                }
                return true;
            }
        }).addPathPatterns("/api/**");
    }

    /** Returns the account authenticated by the security filter, never a user-supplied actor ID. */
    public static Account currentAccount() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof Account account)) {
            throw new IdentityException(401, "AUTHENTICATION_REQUIRED", "Authentication required");
        }
        return account;
    }

    private static IdentityException denied() {
        return new IdentityException(403, "PROJECT_ACCESS_DENIED", "Project scope is missing or access is denied");
    }
}
