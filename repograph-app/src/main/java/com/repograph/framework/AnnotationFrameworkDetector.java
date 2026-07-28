package com.repograph.framework;

import com.repograph.core.model.CodeUnit;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Set;

/**
 * 基于注解字符串匹配的框架识别器，支持 Spring、MyBatis 和 JAX-RS。
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class AnnotationFrameworkDetector implements FrameworkDetector {

    private static final Set<String> SPRING_ANNOTATIONS = Set.of(
            "@Controller", "@RestController", "@Service", "@Repository", "@Component",
            "@Bean", "@Entity", "@RequestMapping", "@GetMapping", "@PostMapping",
            "@PutMapping", "@PatchMapping", "@DeleteMapping", "@Transactional", "@Autowired"
    );

    private static final Set<String> MYBATIS_ANNOTATIONS = Set.of(
            "@Mapper", "@Select", "@Insert", "@Update", "@Delete", "@Results"
    );

    private static final Set<String> JAXRS_ANNOTATIONS = Set.of(
            "@Path", "@GET", "@POST", "@PUT", "@DELETE", "@Produces", "@Consumes"
    );

    @Override
    public Map<String, String> detect(CodeUnit unit) {
        if (unit.annotations() == null || unit.annotations().isEmpty()) {
            return Map.of();
        }
        for (String annotation : unit.annotations()) {
            if (SPRING_ANNOTATIONS.contains(annotation)) {
                return Map.of("framework", "spring");
            }
        }
        for (String annotation : unit.annotations()) {
            if (MYBATIS_ANNOTATIONS.contains(annotation)) {
                return Map.of("framework", "mybatis");
            }
        }
        for (String annotation : unit.annotations()) {
            if (JAXRS_ANNOTATIONS.contains(annotation)) {
                return Map.of("framework", "jaxrs");
            }
        }
        return Map.of();
    }
}
