package com.repograph.sbom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class NpmSbomServiceTest {

    @TempDir
    Path tempDir;

    private NpmSbomService service;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        service = new NpmSbomService(objectMapper);
    }

    private void writePkg(String content) throws Exception {
        Files.writeString(tempDir.resolve("package.json"), content);
    }

    @Test
    void generateCycloneDx_bomFormatAndSpecVersion() throws Exception {
        writePkg("""
            { "name": "my-app", "version": "1.0.0", "dependencies": {} }
            """);
        JsonNode root = objectMapper.readTree(service.generateCycloneDx(tempDir));
        assertThat(root.get("bomFormat").asText()).isEqualTo("CycloneDX");
        assertThat(root.get("specVersion").asText()).isEqualTo("1.4");
    }

    @Test
    void generateCycloneDx_metadataComponent() throws Exception {
        writePkg("""
            { "name": "my-app", "version": "2.3.4" }
            """);
        JsonNode metadata = objectMapper.readTree(service.generateCycloneDx(tempDir))
                .path("metadata").path("component");
        assertThat(metadata.path("name").asText()).isEqualTo("my-app");
        assertThat(metadata.path("version").asText()).isEqualTo("2.3.4");
    }

    @Test
    void generateCycloneDx_parsesProductionDependency() throws Exception {
        writePkg("""
            {
              "name": "my-app", "version": "1.0.0",
              "dependencies": {
                "express": "^4.18.2"
              }
            }
            """);
        JsonNode components = objectMapper.readTree(service.generateCycloneDx(tempDir)).get("components");
        assertThat(components).hasSize(1);
        JsonNode comp = components.get(0);
        assertThat(comp.path("name").asText()).isEqualTo("express");
        assertThat(comp.path("version").asText()).isEqualTo("4.18.2");
        assertThat(comp.path("scope").asText()).isEqualTo("required");
    }

    @Test
    void generateCycloneDx_devDependencyIsExcluded() throws Exception {
        writePkg("""
            {
              "name": "my-app", "version": "1.0.0",
              "devDependencies": {
                "jest": "~29.0.0"
              }
            }
            """);
        JsonNode comp = objectMapper.readTree(service.generateCycloneDx(tempDir))
                .get("components").get(0);
        assertThat(comp.path("scope").asText()).isEqualTo("excluded");
        assertThat(comp.path("version").asText()).isEqualTo("29.0.0");
    }

    @Test
    void generateCycloneDx_peerAndOptionalAreOptional() throws Exception {
        writePkg("""
            {
              "name": "my-app", "version": "1.0.0",
              "peerDependencies": { "react": ">=17" },
              "optionalDependencies": { "fsevents": "~2.3.0" }
            }
            """);
        JsonNode components = objectMapper.readTree(service.generateCycloneDx(tempDir)).get("components");
        assertThat(components).hasSize(2);
        components.forEach(c -> assertThat(c.path("scope").asText()).isEqualTo("optional"));
    }

    @Test
    void generateCycloneDx_scopedPackagePurl() throws Exception {
        writePkg("""
            {
              "name": "my-app", "version": "1.0.0",
              "dependencies": {
                "@angular/core": "^17.0.0"
              }
            }
            """);
        JsonNode comp = objectMapper.readTree(service.generateCycloneDx(tempDir))
                .get("components").get(0);
        assertThat(comp.path("purl").asText()).startsWith("pkg:npm/%40angular/core");
    }

    @Test
    void generateCycloneDx_missingPackageJson_throws() {
        assertThatThrownBy(() -> service.generateCycloneDx(tempDir))
            .isInstanceOf(SbomException.class)
            .hasMessageContaining("package.json");
    }
}
