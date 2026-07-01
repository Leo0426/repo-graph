package com.repograph.sbom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * npm 项目 SBOM 生成服务，解析 {@code package.json} 输出 CycloneDX 1.4 JSON。
 * purl 格式：{@code pkg:npm/name@version}（scoped 包保留 @ 前缀）。
 */
@Component
public class NpmSbomService implements SbomService {

    private static final String CYCLONEDX_SCHEMA_VERSION = "1.4";

    private final ObjectMapper objectMapper;

    public NpmSbomService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public String generateCycloneDx(Path projectRoot) {
        Path pkgJson = projectRoot.resolve("package.json");
        if (!Files.exists(pkgJson)) {
            throw new SbomException("package.json not found in: " + projectRoot);
        }

        JsonNode root;
        try {
            root = objectMapper.readTree(pkgJson.toFile());
        } catch (IOException e) {
            throw new SbomException("Failed to parse package.json: " + e.getMessage(), e);
        }

        String name = root.path("name").asText("");
        String version = root.path("version").asText("");

        List<Dependency> deps = new ArrayList<>();
        collectDeps(root, "dependencies", "required", deps);
        collectDeps(root, "devDependencies", "excluded", deps);
        collectDeps(root, "peerDependencies", "optional", deps);
        collectDeps(root, "optionalDependencies", "optional", deps);

        try {
            return buildCycloneDxJson(name, version, deps);
        } catch (IOException e) {
            throw new SbomException("Failed to serialize CycloneDX JSON: " + e.getMessage(), e);
        }
    }

    private void collectDeps(JsonNode root, String field, String scope, List<Dependency> out) {
        JsonNode node = root.path(field);
        if (node.isMissingNode() || node.isNull()) return;
        node.fields().forEachRemaining(e -> out.add(new Dependency(e.getKey(), e.getValue().asText(""), scope)));
    }

    private String buildCycloneDxJson(String name, String version, List<Dependency> deps) throws IOException {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("bomFormat", "CycloneDX");
        root.put("specVersion", CYCLONEDX_SCHEMA_VERSION);
        root.put("serialNumber", "urn:uuid:" + UUID.randomUUID());
        root.put("version", 1);

        ObjectNode metadata = root.putObject("metadata");
        metadata.put("timestamp", java.time.Instant.now().toString());
        ObjectNode component = metadata.putObject("component");
        component.put("type", "library");
        component.put("name", name);
        if (!version.isEmpty()) component.put("version", version);
        String purl = buildPurl(name, version);
        component.put("purl", purl);
        component.put("bom-ref", purl);

        ArrayNode components = root.putArray("components");
        for (Dependency dep : deps) {
            String depVersion = stripRange(dep.version());
            ObjectNode comp = components.addObject();
            comp.put("type", "library");
            comp.put("name", dep.name());
            if (!depVersion.isEmpty()) comp.put("version", depVersion);
            String depPurl = buildPurl(dep.name(), depVersion);
            comp.put("purl", depPurl);
            comp.put("bom-ref", depPurl);
            comp.put("scope", dep.scope());
        }

        return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(root);
    }

    /** Strip npm version range prefixes (^, ~, >=, etc.) to get a bare version string. */
    private String stripRange(String v) {
        if (v == null || v.isBlank()) return "";
        // Keep scoped package names intact; only strip leading range operators
        return v.replaceFirst("^[~^>=<]+", "").trim();
    }

    private String buildPurl(String name, String version) {
        // Scoped packages: @scope/pkg → pkg:npm/%40scope/pkg@version
        String encodedName = name.startsWith("@") ? "%40" + name.substring(1) : name;
        String base = "pkg:npm/" + encodedName;
        return version.isEmpty() ? base : base + "@" + version;
    }

    private record Dependency(String name, String version, String scope) {}
}
