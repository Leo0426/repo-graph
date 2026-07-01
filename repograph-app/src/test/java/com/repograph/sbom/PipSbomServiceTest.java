package com.repograph.sbom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PipSbomServiceTest {

    @TempDir
    Path tempDir;

    private PipSbomService service;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        service = new PipSbomService(objectMapper);
    }

    // ── requirements.txt ─────────────────────────────────────────────────────

    @Test
    void generateCycloneDx_requirementsTxt_basic() throws Exception {
        Files.writeString(tempDir.resolve("requirements.txt"), """
            requests==2.31.0
            flask>=2.3.0
            # comment line
            """);
        JsonNode components = objectMapper.readTree(service.generateCycloneDx(tempDir)).get("components");
        assertThat(components).hasSize(2);

        JsonNode requests = components.get(0);
        assertThat(requests.path("name").asText()).isEqualTo("requests");
        assertThat(requests.path("version").asText()).isEqualTo("2.31.0");
        assertThat(requests.path("scope").asText()).isEqualTo("required");
    }

    @Test
    void generateCycloneDx_requirementsTxt_stripsInlineComment() throws Exception {
        Files.writeString(tempDir.resolve("requirements.txt"), "boto3==1.28.0  # AWS SDK\n");
        JsonNode comp = objectMapper.readTree(service.generateCycloneDx(tempDir))
                .get("components").get(0);
        assertThat(comp.path("name").asText()).isEqualTo("boto3");
        assertThat(comp.path("version").asText()).isEqualTo("1.28.0");
    }

    @Test
    void generateCycloneDx_requirementsTxt_noVersion() throws Exception {
        Files.writeString(tempDir.resolve("requirements.txt"), "numpy\n");
        JsonNode comp = objectMapper.readTree(service.generateCycloneDx(tempDir))
                .get("components").get(0);
        assertThat(comp.path("name").asText()).isEqualTo("numpy");
        assertThat(comp.has("version")).isFalse();
    }

    @Test
    void generateCycloneDx_requirementsTxt_purlUsesLowercaseName() throws Exception {
        Files.writeString(tempDir.resolve("requirements.txt"), "Pillow==10.0.0\n");
        JsonNode comp = objectMapper.readTree(service.generateCycloneDx(tempDir))
                .get("components").get(0);
        assertThat(comp.path("purl").asText()).isEqualTo("pkg:pypi/pillow@10.0.0");
    }

    // ── pyproject.toml ────────────────────────────────────────────────────────

    @Test
    void generateCycloneDx_pyprojectToml_basic() throws Exception {
        Files.writeString(tempDir.resolve("pyproject.toml"), """
            [project]
            name = "my-pkg"
            version = "0.1.0"
            dependencies = [
              "requests>=2.28",
              "click==8.1.7",
            ]
            """);
        JsonNode root = objectMapper.readTree(service.generateCycloneDx(tempDir));
        assertThat(root.path("metadata").path("component").path("name").asText()).isEqualTo("my-pkg");
        JsonNode components = root.get("components");
        assertThat(StreamSupport.stream(components.spliterator(), false)
            .map(n -> n.path("name").asText()))
            .contains("requests", "click");
    }

    // ── error cases ───────────────────────────────────────────────────────────

    @Test
    void generateCycloneDx_noFiles_throws() {
        assertThatThrownBy(() -> service.generateCycloneDx(tempDir))
            .isInstanceOf(SbomException.class)
            .hasMessageContaining("pyproject.toml");
    }

    // ── bomFormat ─────────────────────────────────────────────────────────────

    @Test
    void generateCycloneDx_bomFormatAndSpecVersion() throws Exception {
        Files.writeString(tempDir.resolve("requirements.txt"), "requests==2.31.0\n");
        JsonNode root = objectMapper.readTree(service.generateCycloneDx(tempDir));
        assertThat(root.path("bomFormat").asText()).isEqualTo("CycloneDX");
        assertThat(root.path("specVersion").asText()).isEqualTo("1.4");
    }
}
