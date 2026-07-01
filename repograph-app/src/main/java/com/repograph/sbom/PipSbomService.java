package com.repograph.sbom;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Python 项目 SBOM 生成服务，解析 {@code requirements.txt} 和 {@code pyproject.toml}，
 * 输出 CycloneDX 1.4 JSON。purl 格式：{@code pkg:pypi/name@version}（名称小写，连字符规范化）。
 *
 * <p>解析优先级：pyproject.toml（{@code [project.dependencies]}）优先，
 * 再扫描 requirements*.txt 文件作为补充。
 */
@Component
public class PipSbomService implements SbomService {

    private static final String CYCLONEDX_SCHEMA_VERSION = "1.4";

    // PEP 508 简化匹配：PackageName[extras] version_specifier ; marker
    private static final Pattern REQ_LINE = Pattern.compile(
            "^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)\\s*" +
            "(?:\\[[^]]*])?\\s*" +
            "([=!<>~^]+\\s*[^\\s;#,]+)?");

    // pyproject.toml [project] name / version
    private static final Pattern PYPROJECT_NAME    = Pattern.compile("(?m)^name\\s*=\\s*\"([^\"]+)\"");
    private static final Pattern PYPROJECT_VERSION = Pattern.compile("(?m)^version\\s*=\\s*\"([^\"]+)\"");

    // [project.dependencies] inline: "pkg>=1.0"
    private static final Pattern PYPROJECT_DEP = Pattern.compile("\"([^\"]+)\"");

    private final ObjectMapper objectMapper;

    public PipSbomService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public String generateCycloneDx(Path projectRoot) {
        boolean hasPyproject = Files.exists(projectRoot.resolve("pyproject.toml"));
        boolean hasRequirements = findRequirementsFiles(projectRoot).length > 0;

        if (!hasPyproject && !hasRequirements) {
            throw new SbomException(
                "No Python dependency file found in: " + projectRoot
                + ". Expected pyproject.toml or requirements*.txt");
        }

        String projectName = projectRoot.getFileName() != null ? projectRoot.getFileName().toString() : "unknown";
        String projectVersion = "";
        LinkedHashSet<Dependency> deps = new LinkedHashSet<>();

        if (hasPyproject) {
            try {
                String content = Files.readString(projectRoot.resolve("pyproject.toml"));
                Matcher mn = PYPROJECT_NAME.matcher(content);
                if (mn.find()) projectName = mn.group(1);
                Matcher mv = PYPROJECT_VERSION.matcher(content);
                if (mv.find()) projectVersion = mv.group(1);
                parsePyprojectDeps(content, deps);
            } catch (IOException e) {
                throw new SbomException("Failed to read pyproject.toml: " + e.getMessage(), e);
            }
        }

        for (Path req : findRequirementsFiles(projectRoot)) {
            try {
                parseRequirementsTxt(Files.readString(req), deps);
            } catch (IOException e) {
                throw new SbomException("Failed to read " + req.getFileName() + ": " + e.getMessage(), e);
            }
        }

        try {
            return buildCycloneDxJson(projectName, projectVersion, List.copyOf(deps));
        } catch (IOException e) {
            throw new SbomException("Failed to serialize CycloneDX JSON: " + e.getMessage(), e);
        }
    }

    // ── pyproject.toml ────────────────────────────────────────────────────────

    private void parsePyprojectDeps(String content, LinkedHashSet<Dependency> out) {
        // Find [project.dependencies] or [project] dependencies = [...] blocks
        int idx = content.indexOf("[project.dependencies]");
        if (idx < 0) {
            // Try inline: dependencies = ["pkg>=1.0", ...]
            idx = content.indexOf("dependencies");
        }
        if (idx < 0) return;

        // Scan from idx until the next top-level section or end of string
        int end = content.indexOf("\n[", idx + 1);
        String section = end < 0 ? content.substring(idx) : content.substring(idx, end);

        Matcher m = PYPROJECT_DEP.matcher(section);
        while (m.find()) {
            parseReqSpec(m.group(1), "required", out);
        }
    }

    // ── requirements.txt ─────────────────────────────────────────────────────

    private void parseRequirementsTxt(String content, LinkedHashSet<Dependency> out) {
        for (String raw : content.split("\n")) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#") || line.startsWith("-")) continue;
            // Strip inline comments
            int hash = line.indexOf('#');
            if (hash >= 0) line = line.substring(0, hash).trim();
            parseReqSpec(line, "required", out);
        }
    }

    private void parseReqSpec(String spec, String scope, LinkedHashSet<Dependency> out) {
        Matcher m = REQ_LINE.matcher(spec.trim());
        if (!m.find()) return;
        String name = m.group(1);
        String verSpec = m.group(3) != null ? m.group(3).trim() : "";
        // Extract bare version from specifier (==1.0 → 1.0; >=1.0 → 1.0)
        String version = verSpec.replaceFirst("^[=!<>~^]+\\s*", "");
        out.add(new Dependency(name, version, scope));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private Path[] findRequirementsFiles(Path projectRoot) {
        List<Path> result = new ArrayList<>();
        try {
            Files.list(projectRoot).forEach(p -> {
                String fname = p.getFileName().toString();
                if (fname.startsWith("requirements") && fname.endsWith(".txt")) {
                    result.add(p);
                }
            });
        } catch (IOException ignored) {}
        return result.toArray(Path[]::new);
    }

    // ── CycloneDX JSON 构建 ───────────────────────────────────────────────────

    private String buildCycloneDxJson(String name, String version, List<Dependency> deps)
            throws IOException {
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
            ObjectNode comp = components.addObject();
            comp.put("type", "library");
            comp.put("name", pypiName(dep.name()));
            if (!dep.version().isEmpty()) comp.put("version", dep.version());
            String depPurl = buildPurl(dep.name(), dep.version());
            comp.put("purl", depPurl);
            comp.put("bom-ref", depPurl);
            comp.put("scope", dep.scope());
        }

        return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(root);
    }

    /** PyPI canonical name: lowercase, replace _ and - with -. */
    private String pypiName(String name) {
        return name.toLowerCase().replace("_", "-");
    }

    private String buildPurl(String name, String version) {
        String base = "pkg:pypi/" + pypiName(name);
        return version.isEmpty() ? base : base + "@" + version;
    }

    private record Dependency(String name, String version, String scope) {}
}
