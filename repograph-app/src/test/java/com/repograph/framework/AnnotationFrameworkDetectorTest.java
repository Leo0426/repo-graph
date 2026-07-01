package com.repograph.framework;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * AnnotationFrameworkDetector 单元测试，验证 Spring 和 JAX-RS 框架注解识别。
 *
 * @author leolu
 * @since 0.1.0
 */
class AnnotationFrameworkDetectorTest {

    private AnnotationFrameworkDetector detector;

    @BeforeEach
    void setUp() {
        detector = new AnnotationFrameworkDetector();
    }

    private CodeUnit unitWithAnnotations(List<String> annotations) {
        return new CodeUnit("id1", CodeUnitKind.CLASS, "java", "Foo", "Foo",
            "Foo.java", 1, 10, "", "class Foo",
            annotations, null, Map.of());
    }

    // ── No annotations ────────────────────────────────────────────────────────

    @Test
    void detect_noAnnotations_returnsEmptyMap() {
        CodeUnit unit = unitWithAnnotations(List.of());
        assertThat(detector.detect(unit)).isEmpty();
    }

    @Test
    void detect_nullAnnotations_returnsEmptyMap() {
        CodeUnit unit = new CodeUnit("id1", CodeUnitKind.CLASS, "java", "Foo", "Foo",
            "Foo.java", 1, 10, "", "class Foo", null, null, Map.of());
        assertThat(detector.detect(unit)).isEmpty();
    }

    // ── Spring detection ──────────────────────────────────────────────────────

    @Test
    void detect_restController_returnsSpring() {
        CodeUnit unit = unitWithAnnotations(List.of("@RestController"));
        assertThat(detector.detect(unit)).containsEntry("framework", "spring");
    }

    @Test
    void detect_service_returnsSpring() {
        CodeUnit unit = unitWithAnnotations(List.of("@Service"));
        assertThat(detector.detect(unit)).containsEntry("framework", "spring");
    }

    @Test
    void detect_getMapping_returnsSpring() {
        CodeUnit unit = unitWithAnnotations(List.of("@GetMapping"));
        assertThat(detector.detect(unit)).containsEntry("framework", "spring");
    }

    @Test
    void detect_transactional_returnsSpring() {
        CodeUnit unit = unitWithAnnotations(List.of("@Transactional"));
        assertThat(detector.detect(unit)).containsEntry("framework", "spring");
    }

    @Test
    void detect_repository_returnsSpring() {
        CodeUnit unit = unitWithAnnotations(List.of("@Repository"));
        assertThat(detector.detect(unit)).containsEntry("framework", "spring");
    }

    // ── JAX-RS detection ──────────────────────────────────────────────────────

    @Test
    void detect_pathAnnotation_returnsJaxrs() {
        CodeUnit unit = unitWithAnnotations(List.of("@Path"));
        assertThat(detector.detect(unit)).containsEntry("framework", "jaxrs");
    }

    @Test
    void detect_jaxrsPost_returnsJaxrs() {
        CodeUnit unit = unitWithAnnotations(List.of("@POST"));
        assertThat(detector.detect(unit)).containsEntry("framework", "jaxrs");
    }

    @Test
    void detect_produces_returnsJaxrs() {
        CodeUnit unit = unitWithAnnotations(List.of("@Produces"));
        assertThat(detector.detect(unit)).containsEntry("framework", "jaxrs");
    }

    @Test
    void detect_component_returnsSpring() {
        assertThat(detector.detect(unitWithAnnotations(List.of("@Component"))))
                .containsEntry("framework", "spring");
    }

    @Test
    void detect_bean_returnsSpring() {
        assertThat(detector.detect(unitWithAnnotations(List.of("@Bean"))))
                .containsEntry("framework", "spring");
    }

    @Test
    void detect_entity_returnsSpring() {
        assertThat(detector.detect(unitWithAnnotations(List.of("@Entity"))))
                .containsEntry("framework", "spring");
    }

    @Test
    void detect_postMapping_returnsSpring() {
        assertThat(detector.detect(unitWithAnnotations(List.of("@PostMapping"))))
                .containsEntry("framework", "spring");
    }

    @Test
    void detect_putMapping_returnsSpring() {
        assertThat(detector.detect(unitWithAnnotations(List.of("@PutMapping"))))
                .containsEntry("framework", "spring");
    }

    @Test
    void detect_deleteMapping_returnsSpring() {
        assertThat(detector.detect(unitWithAnnotations(List.of("@DeleteMapping"))))
                .containsEntry("framework", "spring");
    }

    @Test
    void detect_requestMapping_returnsSpring() {
        assertThat(detector.detect(unitWithAnnotations(List.of("@RequestMapping"))))
                .containsEntry("framework", "spring");
    }

    // ── JAX-RS additional verbs ────────────────────────────────────────────────

    @Test
    void detect_jaxrsGet_returnsJaxrs() {
        assertThat(detector.detect(unitWithAnnotations(List.of("@GET"))))
                .containsEntry("framework", "jaxrs");
    }

    @Test
    void detect_jaxrsPut_returnsJaxrs() {
        assertThat(detector.detect(unitWithAnnotations(List.of("@PUT"))))
                .containsEntry("framework", "jaxrs");
    }

    @Test
    void detect_jaxrsDelete_returnsJaxrs() {
        assertThat(detector.detect(unitWithAnnotations(List.of("@DELETE"))))
                .containsEntry("framework", "jaxrs");
    }

    @Test
    void detect_jaxrsConsumes_returnsJaxrs() {
        assertThat(detector.detect(unitWithAnnotations(List.of("@Consumes"))))
                .containsEntry("framework", "jaxrs");
    }

    // ── Spring takes precedence over JAX-RS ───────────────────────────────────

    @Test
    void detect_springBeforeJaxrs_returnsSpring() {
        CodeUnit unit = unitWithAnnotations(List.of("@Service", "@Path"));
        assertThat(detector.detect(unit)).containsEntry("framework", "spring");
    }

    // ── Non-framework annotation ──────────────────────────────────────────────

    @Test
    void detect_unknownAnnotation_returnsEmptyMap() {
        CodeUnit unit = unitWithAnnotations(List.of("@Override", "@SuppressWarnings"));
        assertThat(detector.detect(unit)).isEmpty();
    }
}
