package com.repograph.sbom;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 基于 Maven {@code pom.xml} 的 SBOM 生成服务，输出 CycloneDX JSON 格式。
 *
 * <p>解析 {@code pom.xml} 中的 {@code <dependency>} 元素，生成符合 CycloneDX 1.4 规范的 JSON SBOM。
 * purl 格式为 {@code pkg:maven/groupId:artifactId@version}（无版本时省略 {@code @version} 部分）。
 * 仅解析直接依赖，不做传递依赖解析。
 *
 * @author leolu
 * @since 0.1.0
 */
@Component
public class MavenSbomService implements SbomService {

    private static final String CYCLONEDX_SCHEMA_VERSION = "1.4";

    private final ObjectMapper objectMapper;

    /**
     * 通过构造器注入 Jackson ObjectMapper。
     *
     * @param objectMapper Jackson 序列化器，不为 {@code null}
     */
    public MavenSbomService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public String generateCycloneDx(Path projectRoot) {
        Path pomFile = projectRoot.resolve("pom.xml");
        if (!Files.exists(pomFile)) {
            throw new SbomException("pom.xml not found in project root: " + projectRoot);
        }

        List<Dependency> deps;
        String projectGroupId;
        String projectArtifactId;
        String projectVersion;
        try {
            DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
            dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            DocumentBuilder db = dbf.newDocumentBuilder();
            Document doc = db.parse(pomFile.toFile());
            doc.getDocumentElement().normalize();

            projectGroupId = getTextContent(doc.getDocumentElement(), "groupId");
            projectArtifactId = getTextContent(doc.getDocumentElement(), "artifactId");
            projectVersion = getTextContent(doc.getDocumentElement(), "version");
            deps = parseDependencies(doc);
        } catch (SbomException e) {
            throw e;
        } catch (Exception e) {
            throw new SbomException("Failed to parse pom.xml: " + e.getMessage(), e);
        }

        try {
            return buildCycloneDxJson(projectGroupId, projectArtifactId, projectVersion, deps);
        } catch (IOException e) {
            throw new SbomException("Failed to serialize CycloneDX JSON: " + e.getMessage(), e);
        }
    }

    // ── pom.xml 解析 ─────────────────────────────────────────────────────────

    private List<Dependency> parseDependencies(Document doc) {
        List<Dependency> deps = new ArrayList<>();
        NodeList dependencyNodes = doc.getElementsByTagName("dependency");
        for (int i = 0; i < dependencyNodes.getLength(); i++) {
            if (!(dependencyNodes.item(i) instanceof Element el)) continue;

            // 跳过 <dependencyManagement> 节内的依赖
            if (isInsideDependencyManagement(el)) continue;

            String groupId = getTextContent(el, "groupId");
            String artifactId = getTextContent(el, "artifactId");
            String version = getTextContent(el, "version");
            String scope = getTextContent(el, "scope");
            if (scope.isEmpty()) scope = "compile";

            if (!groupId.isEmpty() && !artifactId.isEmpty()) {
                deps.add(new Dependency(groupId, artifactId, version, scope));
            }
        }
        return deps;
    }

    private boolean isInsideDependencyManagement(Element el) {
        org.w3c.dom.Node parent = el.getParentNode();
        while (parent != null) {
            if (parent instanceof Element parentEl &&
                "dependencyManagement".equals(parentEl.getTagName())) {
                return true;
            }
            parent = parent.getParentNode();
        }
        return false;
    }

    private String getTextContent(Element parent, String tagName) {
        NodeList nodes = parent.getElementsByTagName(tagName);
        for (int i = 0; i < nodes.getLength(); i++) {
            org.w3c.dom.Node node = nodes.item(i);
            // 仅取直接子节点，避免嵌套元素值渗透
            if (node.getParentNode() == parent) {
                String text = node.getTextContent();
                return text != null ? text.trim() : "";
            }
        }
        return "";
    }

    // ── CycloneDX JSON 构建 ───────────────────────────────────────────────────

    private String buildCycloneDxJson(String groupId, String artifactId, String version,
                                       List<Dependency> deps) throws IOException {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("bomFormat", "CycloneDX");
        root.put("specVersion", CYCLONEDX_SCHEMA_VERSION);
        root.put("serialNumber", "urn:uuid:" + UUID.randomUUID());
        root.put("version", 1);

        // 元数据
        ObjectNode metadata = root.putObject("metadata");
        metadata.put("timestamp", java.time.Instant.now().toString());
        ObjectNode component = metadata.putObject("component");
        component.put("type", "library");
        component.put("group", groupId);
        component.put("name", artifactId);
        if (!version.isEmpty()) component.put("version", version);
        String purl = buildPurl(groupId, artifactId, version);
        component.put("purl", purl);
        component.put("bom-ref", purl);

        // 组件列表
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
            comp.put("scope", mapScope(dep.scope()));
        }

        return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(root);
    }

    private String buildPurl(String groupId, String artifactId, String version) {
        String base = "pkg:maven/" + groupId + "/" + artifactId;
        return version.isEmpty() ? base : base + "@" + version;
    }

    private String mapScope(String mavenScope) {
        return switch (mavenScope.toLowerCase()) {
            case "test" -> "excluded";
            case "provided", "system" -> "optional";
            default -> "required";
        };
    }

    // ── 内部模型 ──────────────────────────────────────────────────────────────

    private record Dependency(String groupId, String artifactId, String version, String scope) {}
}
