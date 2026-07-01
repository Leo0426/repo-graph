package com.repograph.sbom;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Gradle 项目 SBOM 生成服务，解析 {@code gradle/libs.versions.toml} 版本目录
 * 并扫描 build 脚本确定依赖范围，输出 CycloneDX 1.4 JSON。
 */
@Component
public class GradleSbomService implements SbomService {

    private static final String CYCLONEDX_SCHEMA_VERSION = "1.4";

    // 匹配：implementation(libs.foo.bar)、testImplementation(libs.foo.bar) 等
    private static final Pattern CATALOG_DEP_PATTERN = Pattern.compile(
            "(?m)^\\s*(\\w+)\\(libs\\.([\\w.]+)\\)");

    // 匹配：implementation("group:artifact:version") 或 implementation("group:artifact")
    private static final Pattern INLINE_DEP_PATTERN = Pattern.compile(
            "(?m)^\\s*(\\w+)\\(\"([^\"]+)\"\\)");

    private final ObjectMapper objectMapper;

    public GradleSbomService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public String generateCycloneDx(Path projectRoot) {
        Path catalog = findVersionCatalog(projectRoot);
        if (catalog == null) {
            throw new SbomException("No version catalog found. Expected gradle/libs.versions.toml in "
                    + projectRoot + " or its parent directory.");
        }

        Map<String, String> versions = new LinkedHashMap<>();
        List<LibEntry> catalogLibs = new ArrayList<>();
        try {
            parseCatalog(Files.readString(catalog), versions, catalogLibs);
        } catch (IOException e) {
            throw new SbomException("Failed to read version catalog: " + e.getMessage(), e);
        }

        List<String> buildScripts = collectBuildScripts(projectRoot);
        Map<String, String> catalogScopeMap = buildCatalogScopeMap(buildScripts);
        List<InlineDep> inlineDeps = parseInlineDeps(buildScripts);

        List<Dependency> deps = new ArrayList<>();

        // 版本目录中的依赖库
        for (LibEntry lib : catalogLibs) {
            String version = lib.version.isEmpty() ? versions.getOrDefault(lib.versionRef, "") : lib.version;
            // 版本目录别名使用短横线；Gradle 访问器使用点号（picocli-spring → picocli.spring）
            String accessor = lib.alias.replace("-", ".");
            String scope = catalogScopeMap.getOrDefault(accessor, "required");
            deps.add(new Dependency(lib.groupId, lib.artifactId, version, scope));
        }

        // 不在版本目录中的内联字符串依赖
        Set<String> catalogCoords = new HashSet<>();
        for (LibEntry lib : catalogLibs) {
            catalogCoords.add(lib.groupId + ":" + lib.artifactId);
        }
        for (InlineDep inline : inlineDeps) {
            if (!catalogCoords.contains(inline.groupId + ":" + inline.artifactId)) {
                deps.add(new Dependency(inline.groupId, inline.artifactId, inline.version, inline.scope));
            }
        }

        ProjectInfo info = extractProjectInfo(projectRoot);
        try {
            return buildCycloneDxJson(info.group, info.name, info.version, deps);
        } catch (IOException e) {
            throw new SbomException("Failed to serialize CycloneDX JSON: " + e.getMessage(), e);
        }
    }

    // ── 版本目录查找 ──────────────────────────────────────────────────────────

    Path findVersionCatalog(Path projectRoot) {
        Path[] candidates = {
            projectRoot.resolve("gradle/libs.versions.toml"),
            projectRoot.getParent() != null
                ? projectRoot.getParent().resolve("gradle/libs.versions.toml") : null
        };
        for (Path p : candidates) {
            if (p != null && Files.exists(p)) return p;
        }
        return null;
    }

    // ── TOML 解析器 ───────────────────────────────────────────────────────────

    void parseCatalog(String content, Map<String, String> versions, List<LibEntry> libs) {
        String section = "";
        for (String raw : content.split("\n")) {
            String line = raw.trim();
            if (line.startsWith("[")) {
                section = line.replaceAll("[\\[\\]]", "").trim();
                continue;
            }
            if (line.isEmpty() || line.startsWith("#")) continue;

            int eq = line.indexOf('=');
            if (eq < 0) continue;
            String key = line.substring(0, eq).trim();
            String val = line.substring(eq + 1).trim();

            if ("versions".equals(section)) {
                String v = unquote(val);
                if (!v.isEmpty()) versions.put(key, v);
            } else if ("libraries".equals(section)) {
                parseLibEntry(key, val, libs);
            }
        }
    }

    private void parseLibEntry(String alias, String val, List<LibEntry> libs) {
        // val：{ module = "group:artifact", version.ref = "key" } 或 version = "x.y.z"
        String module = extractTomlField(val, "module");
        if (module.isEmpty()) return;
        String[] parts = module.split(":");
        if (parts.length < 2) return;

        String versionRef = extractTomlField(val, "version.ref");
        String versionLit = extractTomlField(val, "version");
        libs.add(new LibEntry(alias, parts[0], parts[1], versionRef, versionLit));
    }

    private String extractTomlField(String val, String field) {
        // 在内联表中查找：field = "value"
        Pattern p = Pattern.compile(Pattern.quote(field) + "\\s*=\\s*\"([^\"]+)\"");
        Matcher m = p.matcher(val);
        return m.find() ? m.group(1) : "";
    }

    private static String unquote(String s) {
        s = s.trim();
        if (s.startsWith("\"") && s.endsWith("\"")) return s.substring(1, s.length() - 1);
        return s;
    }

    // ── 构建脚本扫描 ──────────────────────────────────────────────────────────

    private List<String> collectBuildScripts(Path projectRoot) {
        List<String> contents = new ArrayList<>();
        List<Path> scripts = new ArrayList<>();
        scripts.add(projectRoot.resolve("build.gradle.kts"));
        scripts.add(projectRoot.resolve("build.gradle"));
        // 同时检查父项目构建脚本
        if (projectRoot.getParent() != null) {
            scripts.add(projectRoot.getParent().resolve("build.gradle.kts"));
            scripts.add(projectRoot.getParent().resolve("build.gradle"));
        }
        for (Path s : scripts) {
            if (Files.exists(s)) {
                try { contents.add(Files.readString(s)); } catch (IOException ignored) {}
            }
        }
        return contents;
    }

    private Map<String, String> buildCatalogScopeMap(List<String> buildScripts) {
        Map<String, String> map = new LinkedHashMap<>();
        for (String script : buildScripts) {
            Matcher m = CATALOG_DEP_PATTERN.matcher(script);
            while (m.find()) {
                String configuration = m.group(1);
                String accessor = m.group(2); // e.g. "picocli.spring"
                map.put(accessor, mapConfigToScope(configuration));
            }
        }
        return map;
    }

    private List<InlineDep> parseInlineDeps(List<String> buildScripts) {
        List<InlineDep> result = new ArrayList<>();
        for (String script : buildScripts) {
            Matcher m = INLINE_DEP_PATTERN.matcher(script);
            while (m.find()) {
                String configuration = m.group(1);
                String coord = m.group(2);
                String[] parts = coord.split(":");
                if (parts.length < 2) continue;
                String groupId = parts[0];
                String artifactId = parts[1];
                String version = parts.length >= 3 ? parts[2] : "";
                result.add(new InlineDep(groupId, artifactId, version, mapConfigToScope(configuration)));
            }
        }
        return result;
    }

    private String mapConfigToScope(String configuration) {
        String lc = configuration.toLowerCase();
        if (lc.startsWith("test") || lc.endsWith("runtimeonly") && lc.startsWith("test")) return "excluded";
        if (lc.contains("test")) return "excluded";
        if (lc.startsWith("compileonly")) return "optional";
        if (lc.startsWith("runtimeonly")) return "required";
        return "required";
    }

    // ── 项目信息 ──────────────────────────────────────────────────────────────

    private ProjectInfo extractProjectInfo(Path projectRoot) {
        // 从 settings.gradle.kts 获取 rootProject.name
        String name = projectRoot.getFileName() != null ? projectRoot.getFileName().toString() : "unknown";
        String version = "";
        String group = "";

        List<Path> settingsFiles = List.of(
            projectRoot.resolve("settings.gradle.kts"),
            projectRoot.resolve("settings.gradle"),
            projectRoot.getParent() != null ? projectRoot.getParent().resolve("settings.gradle.kts") : Path.of(""),
            projectRoot.getParent() != null ? projectRoot.getParent().resolve("settings.gradle") : Path.of("")
        );
        for (Path f : settingsFiles) {
            if (!Files.exists(f)) continue;
            try {
                String content = Files.readString(f);
                Matcher m = Pattern.compile("rootProject\\.name\\s*=\\s*\"([^\"]+)\"").matcher(content);
                if (m.find()) { name = m.group(1); break; }
            } catch (IOException ignored) {}
        }

        // 从 build.gradle.kts 获取 group 和 version
        List<Path> buildFiles = List.of(
            projectRoot.resolve("build.gradle.kts"),
            projectRoot.getParent() != null ? projectRoot.getParent().resolve("build.gradle.kts") : Path.of("")
        );
        for (Path f : buildFiles) {
            if (!Files.exists(f)) continue;
            try {
                String content = Files.readString(f);
                Matcher mg = Pattern.compile("group\\s*=\\s*\"([^\"]+)\"").matcher(content);
                if (mg.find()) group = mg.group(1);
                Matcher mv = Pattern.compile("version\\s*=\\s*\"([^\"]+)\"").matcher(content);
                if (mv.find()) version = mv.group(1);
            } catch (IOException ignored) {}
        }

        return new ProjectInfo(group, name, version);
    }

    // ── CycloneDX JSON 构建 ───────────────────────────────────────────────────

    private String buildCycloneDxJson(String group, String name, String version,
                                       List<Dependency> deps) throws IOException {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("bomFormat", "CycloneDX");
        root.put("specVersion", CYCLONEDX_SCHEMA_VERSION);
        root.put("serialNumber", "urn:uuid:" + UUID.randomUUID());
        root.put("version", 1);

        ObjectNode metadata = root.putObject("metadata");
        metadata.put("timestamp", java.time.Instant.now().toString());
        ObjectNode component = metadata.putObject("component");
        component.put("type", "library");
        if (!group.isEmpty()) component.put("group", group);
        component.put("name", name);
        if (!version.isEmpty()) component.put("version", version);
        String purl = buildPurl(group, name, version);
        component.put("purl", purl);
        component.put("bom-ref", purl);

        ArrayNode components = root.putArray("components");
        for (Dependency dep : deps) {
            ObjectNode comp = components.addObject();
            comp.put("type", "library");
            comp.put("group", dep.groupId());
            comp.put("name", dep.artifactId());
            if (!dep.version().isEmpty()) comp.put("version", dep.version());
            String depPurl = buildPurl(dep.groupId(), dep.artifactId(), dep.version());
            comp.put("purl", depPurl);
            comp.put("bom-ref", depPurl);
            comp.put("scope", dep.scope());
        }

        return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(root);
    }

    private String buildPurl(String groupId, String artifactId, String version) {
        String base = "pkg:maven/" + groupId + "/" + artifactId;
        return version.isEmpty() ? base : base + "@" + version;
    }

    // ── 内部模型 ──────────────────────────────────────────────────────────────

    record LibEntry(String alias, String groupId, String artifactId, String versionRef, String version) {}
    record InlineDep(String groupId, String artifactId, String version, String scope) {}
    record Dependency(String groupId, String artifactId, String version, String scope) {}
    record ProjectInfo(String group, String name, String version) {}
}
