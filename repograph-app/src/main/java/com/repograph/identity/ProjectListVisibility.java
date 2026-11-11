package com.repograph.identity;

import com.repograph.api.ProjectsController;
import com.repograph.core.graph.ProjectInfo;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

import java.util.List;

/** Filters project discovery before serialization, including project-root metadata. @author leolu */
@ControllerAdvice
public class ProjectListVisibility implements ResponseBodyAdvice<Object> {
    private final EnterpriseDirectory directory;

    /** Creates visibility filtering for the project discovery endpoint. */
    public ProjectListVisibility(EnterpriseDirectory directory) { this.directory = directory; }

    @Override
    public boolean supports(MethodParameter method, Class<? extends HttpMessageConverter<?>> converter) {
        return method.getContainingClass() == ProjectsController.class && method.getMethod() != null
                && method.getMethod().getName().equals("projects");
    }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter method, MediaType type,
                                  Class<? extends HttpMessageConverter<?>> converter,
                                  ServerHttpRequest request, ServerHttpResponse response) {
        var actor = ProjectAccessConfiguration.currentAccount();
        if (actor.role().equals("ADMIN")) return body;
        if (!(body instanceof List<?> projects)) throw new IllegalStateException("Unexpected project list response");
        return projects.stream().filter(value -> value instanceof ProjectInfo project
                && directory.canAccessProject(actor.id(), project.projectId())).toList();
    }
}
