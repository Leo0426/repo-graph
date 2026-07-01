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

/**
 * MavenSbomService 单元测试，使用临时目录写入 pom.xml fixture 进行验证。
 *
 * @author leolu
 * @since 0.1.0
 */
class MavenSbomServiceTest {

    @TempDir
    Path tempDir;

    private MavenSbomService service;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        service = new MavenSbomService(objectMapper);
    }

    private void writePom(String content) throws Exception {
        Files.writeString(tempDir.resolve("pom.xml"), content);
    }

    // ── bomFormat and specVersion ─────────────────────────────────────────────

    @Test
    void generateCycloneDx_producesCorrectBomFormat() throws Exception {
        writePom("""
            <project>
              <groupId>com.example</groupId>
              <artifactId>my-app</artifactId>
              <version>1.0</version>
              <dependencies/>
            </project>
            """);
        String json = service.generateCycloneDx(tempDir);
        JsonNode root = objectMapper.readTree(json);
        assertThat(root.get("bomFormat").asText()).isEqualTo("CycloneDX");
    }

    @Test
    void generateCycloneDx_specVersion1_4() throws Exception {
        writePom("""
            <project>
              <groupId>com.example</groupId>
              <artifactId>my-app</artifactId>
              <version>1.0</version>
              <dependencies/>
            </project>
            """);
        String json = service.generateCycloneDx(tempDir);
        JsonNode root = objectMapper.readTree(json);
        assertThat(root.get("specVersion").asText()).isEqualTo("1.4");
    }

    // ── Dependency parsing ────────────────────────────────────────────────────

    @Test
    void generateCycloneDx_parsesNormalDependency() throws Exception {
        writePom("""
            <project>
              <groupId>com.example</groupId>
              <artifactId>my-app</artifactId>
              <version>1.0</version>
              <dependencies>
                <dependency>
                  <groupId>org.springframework.boot</groupId>
                  <artifactId>spring-boot-starter</artifactId>
                  <version>3.4.5</version>
                </dependency>
              </dependencies>
            </project>
            """);
        String json = service.generateCycloneDx(tempDir);
        JsonNode components = objectMapper.readTree(json).get("components");
        assertThat(components).hasSize(1);
        JsonNode comp = components.get(0);
        assertThat(comp.get("group").asText()).isEqualTo("org.springframework.boot");
        assertThat(comp.get("name").asText()).isEqualTo("spring-boot-starter");
        assertThat(comp.get("version").asText()).isEqualTo("3.4.5");
    }

    // ── dependencyManagement exclusion ────────────────────────────────────────

    @Test
    void generateCycloneDx_excludesDependencyManagementEntries() throws Exception {
        writePom("""
            <project>
              <groupId>com.example</groupId>
              <artifactId>my-app</artifactId>
              <version>1.0</version>
              <dependencyManagement>
                <dependencies>
                  <dependency>
                    <groupId>org.springframework.boot</groupId>
                    <artifactId>spring-boot-dependencies</artifactId>
                    <version>3.4.5</version>
                    <type>pom</type>
                    <scope>import</scope>
                  </dependency>
                </dependencies>
              </dependencyManagement>
              <dependencies>
                <dependency>
                  <groupId>com.fasterxml.jackson.core</groupId>
                  <artifactId>jackson-databind</artifactId>
                  <version>2.17.2</version>
                </dependency>
              </dependencies>
            </project>
            """);
        String json = service.generateCycloneDx(tempDir);
        JsonNode components = objectMapper.readTree(json).get("components");
        assertThat(components).hasSize(1);
        assertThat(components.get(0).get("name").asText()).isEqualTo("jackson-databind");
    }

    // ── Scope mapping ─────────────────────────────────────────────────────────

    @Test
    void generateCycloneDx_testScopeIsExcluded() throws Exception {
        writePom("""
            <project>
              <groupId>com.example</groupId>
              <artifactId>my-app</artifactId>
              <version>1.0</version>
              <dependencies>
                <dependency>
                  <groupId>org.junit.jupiter</groupId>
                  <artifactId>junit-jupiter</artifactId>
                  <version>5.10.0</version>
                  <scope>test</scope>
                </dependency>
              </dependencies>
            </project>
            """);
        String json = service.generateCycloneDx(tempDir);
        JsonNode comp = objectMapper.readTree(json).get("components").get(0);
        assertThat(comp.get("scope").asText()).isEqualTo("excluded");
    }

    // ── Missing version ───────────────────────────────────────────────────────

    @Test
    void generateCycloneDx_missingVersionOmitsAtVersionInPurl() throws Exception {
        writePom("""
            <project>
              <groupId>com.example</groupId>
              <artifactId>my-app</artifactId>
              <version>1.0</version>
              <dependencies>
                <dependency>
                  <groupId>com.example</groupId>
                  <artifactId>some-dep</artifactId>
                </dependency>
              </dependencies>
            </project>
            """);
        String json = service.generateCycloneDx(tempDir);
        JsonNode comp = objectMapper.readTree(json).get("components").get(0);
        String purl = comp.get("purl").asText();
        assertThat(purl).doesNotContain("@");
    }

    // ── Missing pom.xml ───────────────────────────────────────────────────────

    @Test
    void generateCycloneDx_noPomXml_throwsSbomException() {
        assertThatThrownBy(() -> service.generateCycloneDx(tempDir))
            .isInstanceOf(SbomException.class)
            .hasMessageContaining("pom.xml");
    }

    // ── Additional scope mappings ─────────────────────────────────────────────

    @Test
    void generateCycloneDx_providedScope_mapsToOptional() throws Exception {
        writePom("""
            <project>
              <groupId>com.example</groupId>
              <artifactId>my-app</artifactId>
              <version>1.0</version>
              <dependencies>
                <dependency>
                  <groupId>javax.servlet</groupId>
                  <artifactId>javax.servlet-api</artifactId>
                  <version>4.0.1</version>
                  <scope>provided</scope>
                </dependency>
              </dependencies>
            </project>
            """);
        JsonNode comp = objectMapper.readTree(service.generateCycloneDx(tempDir))
                .get("components").get(0);
        assertThat(comp.get("scope").asText()).isEqualTo("optional");
    }

    @Test
    void generateCycloneDx_runtimeScope_mapsToRequired() throws Exception {
        writePom("""
            <project>
              <groupId>com.example</groupId>
              <artifactId>my-app</artifactId>
              <version>1.0</version>
              <dependencies>
                <dependency>
                  <groupId>org.postgresql</groupId>
                  <artifactId>postgresql</artifactId>
                  <version>42.7.0</version>
                  <scope>runtime</scope>
                </dependency>
              </dependencies>
            </project>
            """);
        JsonNode comp = objectMapper.readTree(service.generateCycloneDx(tempDir))
                .get("components").get(0);
        assertThat(comp.get("scope").asText()).isEqualTo("required");
    }

    @Test
    void generateCycloneDx_multipleDependencies_allInComponents() throws Exception {
        writePom("""
            <project>
              <groupId>com.example</groupId>
              <artifactId>my-app</artifactId>
              <version>1.0</version>
              <dependencies>
                <dependency>
                  <groupId>org.springframework.boot</groupId>
                  <artifactId>spring-boot-starter</artifactId>
                  <version>3.4.5</version>
                </dependency>
                <dependency>
                  <groupId>com.fasterxml.jackson.core</groupId>
                  <artifactId>jackson-databind</artifactId>
                  <version>2.17.2</version>
                </dependency>
                <dependency>
                  <groupId>org.junit.jupiter</groupId>
                  <artifactId>junit-jupiter</artifactId>
                  <version>5.10.0</version>
                  <scope>test</scope>
                </dependency>
              </dependencies>
            </project>
            """);
        JsonNode components = objectMapper.readTree(service.generateCycloneDx(tempDir))
                .get("components");
        assertThat(components).hasSize(3);
    }

    @Test
    void generateCycloneDx_purlContainsGroupArtifactAndVersion() throws Exception {
        writePom("""
            <project>
              <groupId>com.example</groupId>
              <artifactId>my-app</artifactId>
              <version>1.0</version>
              <dependencies>
                <dependency>
                  <groupId>io.qdrant</groupId>
                  <artifactId>client</artifactId>
                  <version>1.9.1</version>
                </dependency>
              </dependencies>
            </project>
            """);
        JsonNode comp = objectMapper.readTree(service.generateCycloneDx(tempDir))
                .get("components").get(0);
        String purl = comp.get("purl").asText();
        assertThat(purl).contains("io.qdrant").contains("client").contains("1.9.1");
    }
}
