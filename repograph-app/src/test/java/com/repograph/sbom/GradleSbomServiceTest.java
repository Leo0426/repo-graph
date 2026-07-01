package com.repograph.sbom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GradleSbomServiceTest {

    private final GradleSbomService service = new GradleSbomService(new ObjectMapper());

    @TempDir
    Path tmp;

    // ── parseCatalog ────────────────────────────────────────────────────────────

    @Test
    void parseCatalog_parsesVersionsAndLibraries() {
        String toml = """
                [versions]
                foo = "1.2.3"
                bar = "4.5.6"

                [libraries]
                my-lib = { module = "com.example:my-lib", version.ref = "foo" }
                other  = { module = "org.other:other-core", version = "9.0.0" }
                """;

        Map<String, String> versions = new LinkedHashMap<>();
        List<GradleSbomService.LibEntry> libs = new ArrayList<>();
        service.parseCatalog(toml, versions, libs);

        assertThat(versions).containsEntry("foo", "1.2.3").containsEntry("bar", "4.5.6");
        assertThat(libs).hasSize(2);

        GradleSbomService.LibEntry first = libs.get(0);
        assertThat(first.alias()).isEqualTo("my-lib");
        assertThat(first.groupId()).isEqualTo("com.example");
        assertThat(first.artifactId()).isEqualTo("my-lib");
        assertThat(first.versionRef()).isEqualTo("foo");
        assertThat(first.version()).isEmpty();

        GradleSbomService.LibEntry second = libs.get(1);
        assertThat(second.alias()).isEqualTo("other");
        assertThat(second.version()).isEqualTo("9.0.0");
        assertThat(second.versionRef()).isEmpty();
    }

    // ── findVersionCatalog ──────────────────────────────────────────────────────

    @Test
    void findVersionCatalog_findsInGradleSubdir() throws Exception {
        Path gradleDir = tmp.resolve("gradle");
        Files.createDirectories(gradleDir);
        Path catalog = gradleDir.resolve("libs.versions.toml");
        Files.writeString(catalog, "[versions]\n");

        assertThat(service.findVersionCatalog(tmp)).isEqualTo(catalog);
    }

    @Test
    void findVersionCatalog_findsInParentGradleSubdir() throws Exception {
        Path parent = tmp;
        Path gradleDir = parent.resolve("gradle");
        Files.createDirectories(gradleDir);
        Path catalog = gradleDir.resolve("libs.versions.toml");
        Files.writeString(catalog, "[versions]\n");

        Path submodule = parent.resolve("my-module");
        Files.createDirectories(submodule);

        assertThat(service.findVersionCatalog(submodule)).isEqualTo(catalog);
    }

    @Test
    void findVersionCatalog_returnsNullWhenAbsent() {
        assertThat(service.findVersionCatalog(tmp)).isNull();
    }

    // ── generateCycloneDx ──────────────────────────────────────────────────────

    @Test
    void generateCycloneDx_producesValidCycloneDxJson() throws Exception {
        // Write catalog
        Path gradleDir = tmp.resolve("gradle");
        Files.createDirectories(gradleDir);
        Files.writeString(gradleDir.resolve("libs.versions.toml"), """
                [versions]
                jackson = "2.17.2"

                [libraries]
                jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
                neo4j-harness    = { module = "org.neo4j.test:neo4j-harness", version.ref = "jackson" }
                """);

        // Write build script with scopes
        Files.writeString(tmp.resolve("build.gradle.kts"), """
                dependencies {
                    implementation(libs.jackson.databind)
                    testImplementation(libs.neo4j.harness)
                }
                """);

        String json = service.generateCycloneDx(tmp);
        JsonNode bom = new ObjectMapper().readTree(json);

        assertThat(bom.get("bomFormat").asText()).isEqualTo("CycloneDX");
        assertThat(bom.get("specVersion").asText()).isEqualTo("1.4");

        JsonNode components = bom.get("components");
        assertThat(components.size()).isEqualTo(2);

        JsonNode jackson = components.get(0);
        assertThat(jackson.get("name").asText()).isEqualTo("jackson-databind");
        assertThat(jackson.get("version").asText()).isEqualTo("2.17.2");
        assertThat(jackson.get("scope").asText()).isEqualTo("required");

        JsonNode neo4j = components.get(1);
        assertThat(neo4j.get("name").asText()).isEqualTo("neo4j-harness");
        assertThat(neo4j.get("scope").asText()).isEqualTo("excluded");
    }

    @Test
    void generateCycloneDx_includesInlineStringDeps() throws Exception {
        Path gradleDir = tmp.resolve("gradle");
        Files.createDirectories(gradleDir);
        Files.writeString(gradleDir.resolve("libs.versions.toml"), "[versions]\n[libraries]\n");
        Files.writeString(tmp.resolve("build.gradle.kts"), """
                dependencies {
                    implementation("org.springframework.boot:spring-boot-starter")
                    testImplementation("org.springframework.boot:spring-boot-starter-test:3.4.5")
                }
                """);

        String json = service.generateCycloneDx(tmp);
        JsonNode components = new ObjectMapper().readTree(json).get("components");

        assertThat(components.size()).isEqualTo(2);
        JsonNode boot = components.get(0);
        assertThat(boot.get("name").asText()).isEqualTo("spring-boot-starter");
        assertThat(boot.get("scope").asText()).isEqualTo("required");
        JsonNode test = components.get(1);
        assertThat(test.get("scope").asText()).isEqualTo("excluded");
        assertThat(test.get("version").asText()).isEqualTo("3.4.5");
    }

    @Test
    void generateCycloneDx_throwsWhenNoCatalogOrBuildScript() {
        assertThatThrownBy(() -> service.generateCycloneDx(tmp))
                .isInstanceOf(SbomException.class)
                .hasMessageContaining("version catalog");
    }
}
