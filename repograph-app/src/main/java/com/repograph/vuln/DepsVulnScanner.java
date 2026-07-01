package com.repograph.vuln;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.sbom.SbomService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/**
 * 依赖漏洞扫描器，基于 SBOM + Advisory 数据库识别已知 CVE。
 *
 * <p>流程：
 * <ol>
 *   <li>调用 {@link SbomService#generateCycloneDx} 生成 CycloneDX JSON；</li>
 *   <li>提取 {@code components} 中的 Maven 坐标（groupId / artifactId / version）；</li>
 *   <li>跳过 {@code scope=excluded}（测试依赖）；</li>
 *   <li>查询 {@link AdvisoryStore} 匹配 Advisory；</li>
 *   <li>用 {@link SemanticVersion} 校验版本是否在受影响区间内；</li>
 *   <li>去重后批量写入 {@link VulnStore}。</li>
 * </ol>
 *
 * <p>Finding ID = {@code SHA256(projectId:DEP_VULNERABILITY:dep:groupId:artifactId:version:cveId)[:16]}，
 * 确保同一 CVE 在同一项目的同一版本依赖下不重复记录。
 *
 * @author leolu
 * @since 0.5.0
 */
@Service
public class DepsVulnScanner {

    private static final Logger log = LoggerFactory.getLogger(DepsVulnScanner.class);
    private static final String RULE_ID = "DEP_VULNERABILITY";

    private final SbomService sbomService;
    private final AdvisoryStore advisoryStore;
    private final VulnStore vulnStore;
    private final ObjectMapper objectMapper;

    public DepsVulnScanner(SbomService sbomService, AdvisoryStore advisoryStore,
                            VulnStore vulnStore, ObjectMapper objectMapper) {
        this.sbomService   = sbomService;
        this.advisoryStore = advisoryStore;
        this.vulnStore     = vulnStore;
        this.objectMapper  = objectMapper;
    }

    /**
     * 扫描项目依赖，返回扫描摘要。
     *
     * @param projectId   项目 ID（用于 finding 归属）
     * @param projectRoot 项目根目录（用于定位 pom.xml）
     * @return 扫描摘要，包含扫描的组件数和新增 finding 数
     */
    public ScanSummary scan(String projectId, Path projectRoot) {
        List<Component> components;
        try {
            String sbomJson = sbomService.generateCycloneDx(projectRoot);
            components = parseComponents(sbomJson);
        } catch (Exception e) {
            log.warn("Failed to generate SBOM for {}: {}", projectRoot, e.getMessage());
            return new ScanSummary(0, 0);
        }

        String now = Instant.now().toString();
        List<VulnFinding> findings = new ArrayList<>();

        for (Component comp : components) {
            if ("excluded".equals(comp.scope())) continue; // 跳过测试依赖

            List<AdvisoryStore.Advisory> advisories =
                    advisoryStore.findByCoordinate(comp.groupId(), comp.artifactId());

            SemanticVersion compVer = SemanticVersion.of(comp.version());

            for (AdvisoryStore.Advisory adv : advisories) {
                if (!isAffected(compVer, adv)) continue;

                String unitId = "dep:" + comp.groupId() + ":" + comp.artifactId()
                        + ":" + comp.version() + ":" + adv.id();
                String id = sha256Prefix(projectId + ":" + RULE_ID + ":" + unitId);

                String detail = buildDetail(comp, adv);

                findings.add(new VulnFinding(
                        id,
                        projectId,
                        RULE_ID,
                        adv.cwe(),
                        adv.severity(),
                        VulnFinding.SUSPECTED,
                        unitId,
                        comp.groupId() + ":" + comp.artifactId(),
                        "pom.xml",
                        0,
                        adv.id() + " — " + adv.summary(),
                        detail,
                        now
                ));
            }
        }

        vulnStore.upsertAll(findings);
        log.info("Dep scan [{}]: {} components, {} potential findings", projectId, components.size(), findings.size());
        return new ScanSummary(components.size(), findings.size());
    }

    public record ScanSummary(int scannedComponents, int newFindings) {}

    // ── 内部方法 ──────────────────────────────────────────────────────────────

    private List<Component> parseComponents(String sbomJson) throws Exception {
        JsonNode root = objectMapper.readTree(sbomJson);
        JsonNode comps = root.path("components");
        List<Component> result = new ArrayList<>();
        if (comps.isArray()) {
            for (JsonNode c : comps) {
                String group   = c.path("group").asText("");
                String name    = c.path("name").asText("");
                String version = c.path("version").asText("");
                String scope   = c.path("scope").asText("required");
                if (!group.isBlank() && !name.isBlank()) {
                    result.add(new Component(group, name, version, scope));
                }
            }
        }
        return result;
    }

    private boolean isAffected(SemanticVersion ver, AdvisoryStore.Advisory adv) {
        // introduced 为空 → fixed 之前的所有版本均受影响
        boolean afterIntroduced = adv.introduced() == null || adv.introduced().isBlank()
                || ver.isGreaterThanOrEqual(SemanticVersion.of(adv.introduced()));
        // fixed 为空 → 尚无修复版本，所有版本均受影响
        boolean beforeFixed = adv.fixed() == null || adv.fixed().isBlank()
                || ver.isLessThan(SemanticVersion.of(adv.fixed()));
        return afterIntroduced && beforeFixed;
    }

    private String buildDetail(Component comp, AdvisoryStore.Advisory adv) {
        StringBuilder sb = new StringBuilder();
        sb.append(comp.groupId()).append(":").append(comp.artifactId())
          .append("@").append(comp.version().isBlank() ? "unknown" : comp.version());
        sb.append(" 受 ").append(adv.id()).append(" 影响");
        if (adv.fixed() != null && !adv.fixed().isBlank()) {
            sb.append("，建议升级至 ").append(adv.fixed()).append(" 或更高版本");
        } else {
            sb.append("，暂无官方修复版本，建议移除或替换该依赖");
        }
        return sb.toString();
    }

    private static String sha256Prefix(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest).substring(0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    private record Component(String groupId, String artifactId, String version, String scope) {}
}
