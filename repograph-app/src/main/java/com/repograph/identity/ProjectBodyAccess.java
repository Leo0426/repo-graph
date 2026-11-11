package com.repograph.identity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.RequestBodyAdviceAdapter;

import java.lang.reflect.Type;

/** Checks ownership-bearing request bodies after parsing and before any controller side effect. @author leolu */
@ControllerAdvice
public class ProjectBodyAccess extends RequestBodyAdviceAdapter {
    private final EnterpriseDirectory directory;
    private final ResourceProjectLookup resources;
    private final ObjectMapper json;

    /** Creates body-scoped authorization using the same directory as URI-based checks. */
    public ProjectBodyAccess(EnterpriseDirectory directory, ResourceProjectLookup resources, ObjectMapper json) {
        this.directory = directory;
        this.resources = resources;
        this.json = json;
    }

    @Override
    public boolean supports(MethodParameter parameter, Type targetType,
                            Class<? extends HttpMessageConverter<?>> converter) {
        ProjectAccess policy = parameter.getMethodAnnotation(ProjectAccess.class);
        return policy != null && policy.source() == ProjectAccess.Source.BODY;
    }

    @Override
    public Object afterBodyRead(Object body, HttpInputMessage input, MethodParameter parameter,
                                Type type, Class<? extends HttpMessageConverter<?>> converter) {
        var actor = ProjectAccessConfiguration.currentAccount();
        if (actor.role().equals("ADMIN")) return body;
        ProjectAccess policy = parameter.getMethodAnnotation(ProjectAccess.class);
        JsonNode selector = json.valueToTree(body).path(policy.value());
        if (selector.isArray()) {
            if (selector.isEmpty() || selector.size() > 100) throw denied();
            for (JsonNode value : selector) check(actor.id(), policy, value);
        } else check(actor.id(), policy, selector);
        return body;
    }

    @Override
    public Object handleEmptyBody(Object body, HttpInputMessage input, MethodParameter parameter,
                                  Type type, Class<? extends HttpMessageConverter<?>> converter) {
        throw denied();
    }

    private void check(String accountId, ProjectAccess policy, JsonNode value) {
        if (!value.isTextual() || !directory.canAccessProject(accountId,
                resources.project(policy.resource(), value.textValue()))) throw denied();
    }

    private static IdentityException denied() {
        return new IdentityException(403, "PROJECT_ACCESS_DENIED", "Request contains an inaccessible project or resource");
    }
}
