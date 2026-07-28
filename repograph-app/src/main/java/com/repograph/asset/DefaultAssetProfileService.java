package com.repograph.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.asset.AssetFileCategory;
import com.repograph.core.asset.AssetNotReadyException;
import com.repograph.core.asset.AssetProfileOptions;
import com.repograph.core.asset.AssetProfileService;
import com.repograph.core.asset.AssetRiskSignal;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ClassifiedAssetFile;
import com.repograph.core.asset.DependencyAsset;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.asset.ProjectAssetProfile;
import com.repograph.core.asset.ScannerPlanItem;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectStats;
import com.repograph.core.model.CodeUnit;
import com.repograph.metrics.GitChurnAnalyzer;
import com.repograph.metrics.HotspotMetric;
import com.repograph.sbom.SbomService;
import com.repograph.vuln.VulnFinding;
import com.repograph.vuln.VulnStore;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import java.util.stream.Stream;

/**
 * 基于托管源码、现有图谱、SBOM 和漏洞记录生成资产画像。
 *
 * @author leolu
 */
@Service
public class DefaultAssetProfileService implements AssetProfileService {

    private static final long MAX_HINT_FILE_BYTES = 1024 * 1024;
    private static final List<String> SCANNERS = List.of(
            "REPOGRAPH_CODE", "REPOGRAPH_TAINT", "REPOGRAPH_PRECISE_TAINT",
            "SEMGREP", "CODEQL", "SLITHER", "DEPENDENCY_CVE");
    private static final Set<String> GENERATED_SEGMENTS = Set.of(
            "target", "build", "out", "dist", "node_modules", "vendor", "__pycache__",
            "generated", "generated-sources", ".git", ".gradle", ".idea", ".vscode");
    private static final Set<String> DOCUMENT_EXTENSIONS = Set.of(
            "md", "markdown", "rst", "adoc", "asciidoc", "txt");
    private static final Set<String> CODE_EXTENSIONS = Set.of(
            "java", "kt", "kts", "c", "h", "cc", "cpp", "cxx", "hpp", "py", "js", "jsx",
            "ts", "tsx", "go", "rs", "php", "rb", "swift", "cs", "sol", "scala", "groovy");
    private static final Set<String> CONFIG_EXTENSIONS = Set.of(
            "xml", "yml", "yaml", "properties", "toml", "json", "gradle", "lock");

    private final GraphQueryService graphQueryService;
    private final GraphDiagnosticsService graphDiagnosticsService;
    private final SbomService sbomService;
    private final ObjectMapper objectMapper;
    private final VulnStore vulnStore;
    private final GitChurnAnalyzer gitChurnAnalyzer;

    /**
     * 创建默认资产画像服务。
     *
     * @param graphQueryService       图查询服务
     * @param graphDiagnosticsService 图诊断查询服务
     * @param sbomService             SBOM 服务
     * @param objectMapper            JSON 解析器
     * @param vulnStore               漏洞记录存储
     * @param gitChurnAnalyzer        Git 热点分析器
     */
    public DefaultAssetProfileService(
            GraphQueryService graphQueryService,
            GraphDiagnosticsService graphDiagnosticsService,
            SbomService sbomService,
            ObjectMapper objectMapper,
            VulnStore vulnStore,
            GitChurnAnalyzer gitChurnAnalyzer) {
        this.graphQueryService = graphQueryService;
        this.graphDiagnosticsService = graphDiagnosticsService;
        this.sbomService = sbomService;
        this.objectMapper = objectMapper;
        this.vulnStore = vulnStore;
        this.gitChurnAnalyzer = gitChurnAnalyzer;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public ProjectAssetProfile build(ImportedAsset asset, AssetProfileOptions options) {
        if (asset.status() != AssetStatus.READY) {
            throw new AssetNotReadyException(
                    "Asset '" + asset.assetId() + "' is not ready: " + asset.status());
        }
        Path projectRoot = asset.projectRoot().toAbsolutePath().normalize();
        if (!Files.isDirectory(projectRoot)) {
            throw new IllegalStateException("Managed project root does not exist: " + projectRoot);
        }

        List<String> omittedReasons = new ArrayList<>();
        List<ClassifiedAssetFile> files = scanFiles(projectRoot);
        Map<String, Long> categories = distribution(files, file -> file.category().name());
        Map<String, Long> languages = distribution(
                files.stream().filter(file -> !file.language().isBlank()).toList(),
                ClassifiedAssetFile::language);
        ProjectStats stats = loadStats(asset.projectId(), omittedReasons);
        List<String> frameworks = detectFrameworks(projectRoot, files, stats);
        List<String> buildSystems = detectBuildSystems(files);
        List<DependencyAsset> dependencies = loadDependencies(projectRoot, omittedReasons);
        List<AssetRiskSignal> risks = detectRisks(asset.projectId(), projectRoot, files, omittedReasons);
        List<ScannerPlanItem> scannerPlan = buildScannerPlan(
                languages.keySet(), buildSystems, options == null ? AssetProfileOptions.defaults() : options);

        return new ProjectAssetProfile(
                asset.assetId(),
                asset.projectId(),
                projectRoot,
                Instant.now().toString(),
                files.size(),
                categories,
                languages,
                files,
                frameworks,
                buildSystems,
                dependencies,
                risks,
                scannerPlan,
                omittedReasons);
    }

    private List<ClassifiedAssetFile> scanFiles(Path root) {
        try (Stream<Path> paths = Files.walk(root)) {
            return paths.filter(Files::isRegularFile)
                    .map(path -> classify(root, path))
                    .sorted(Comparator.comparing(ClassifiedAssetFile::path))
                    .toList();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to enumerate managed project files", e);
        }
    }

    private ClassifiedAssetFile classify(Path root, Path file) {
        String path = normalizePath(root.relativize(file));
        String lower = path.toLowerCase(Locale.ROOT);
        String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
        String extension = extensionOf(name);
        AssetFileCategory category;
        String reason;
        if (containsSegment(lower, GENERATED_SEGMENTS)) {
            category = AssetFileCategory.GENERATED;
            reason = "path belongs to a generated, dependency, or build-output directory";
        } else if (isTestPath(lower, name)) {
            category = AssetFileCategory.TEST;
            reason = "path or file name matches a test convention";
        } else if (containsSegment(lower, Set.of("docs", "doc"))
                || DOCUMENT_EXTENSIONS.contains(extension)
                || name.startsWith("readme") || name.startsWith("license") || name.startsWith("changelog")) {
            category = AssetFileCategory.DOCUMENTATION;
            reason = "path or extension identifies project documentation";
        } else if (CODE_EXTENSIONS.contains(extension)
                || CONFIG_EXTENSIONS.contains(extension)
                || isKnownBusinessFile(name)) {
            category = AssetFileCategory.BUSINESS;
            reason = "recognized source, build, or runtime configuration file";
        } else {
            category = AssetFileCategory.UNKNOWN;
            reason = "no reliable source, test, documentation, or generated-file convention matched";
        }
        try {
            return new ClassifiedAssetFile(path, category, reason, languageOf(name, extension), Files.size(file));
        } catch (IOException e) {
            throw new IllegalStateException("Failed to inspect managed file: " + path, e);
        }
    }

    private ProjectStats loadStats(String projectId, List<String> omittedReasons) {
        try {
            return graphQueryService.projectStats(projectId);
        } catch (RuntimeException e) {
            omittedReasons.add("graph statistics unavailable: " + safeMessage(e));
            return new ProjectStats(
                    projectId, "", 0, 0, 0, 0, 0,
                    Map.of(), Map.of(), Map.of(), Map.of());
        }
    }

    private List<String> detectFrameworks(
            Path root,
            List<ClassifiedAssetFile> files,
            ProjectStats stats) {
        Set<String> frameworks = new LinkedHashSet<>();
        stats.frameworkDistribution().keySet().stream()
                .map(value -> value.toLowerCase(Locale.ROOT))
                .sorted()
                .forEach(frameworks::add);
        for (ClassifiedAssetFile file : files) {
            if (file.category() == AssetFileCategory.GENERATED || file.sizeBytes() > MAX_HINT_FILE_BYTES) {
                continue;
            }
            String content = readHintText(root.resolve(file.path()));
            String lower = content.toLowerCase(Locale.ROOT);
            if (lower.contains("@restcontroller") || lower.contains("@springbootapplication")
                    || lower.contains("org.springframework")) {
                frameworks.add("spring");
            }
            if (lower.contains("@path(") || lower.contains("jakarta.ws.rs")
                    || lower.contains("javax.ws.rs")) {
                frameworks.add("jaxrs");
            }
            if (lower.contains("@mapper") || lower.contains("org.apache.ibatis")
                    || lower.contains("mybatis")) {
                frameworks.add("mybatis");
            }
        }
        return frameworks.stream().sorted().toList();
    }

    private List<String> detectBuildSystems(List<ClassifiedAssetFile> files) {
        Set<String> detected = new LinkedHashSet<>();
        for (ClassifiedAssetFile file : files) {
            String name = Path.of(file.path()).getFileName().toString().toLowerCase(Locale.ROOT);
            if (name.equals("pom.xml")) {
                detected.add("maven");
            } else if (name.equals("build.gradle") || name.equals("build.gradle.kts")
                    || name.equals("settings.gradle") || name.equals("settings.gradle.kts")) {
                detected.add("gradle");
            } else if (name.equals("package.json")) {
                detected.add("npm");
            } else if (name.equals("pyproject.toml") || name.startsWith("requirements")
                    && name.endsWith(".txt")) {
                detected.add("pip");
            }
        }
        return List.of("maven", "gradle", "npm", "pip").stream()
                .filter(detected::contains)
                .toList();
    }

    private List<DependencyAsset> loadDependencies(Path root, List<String> omittedReasons) {
        try {
            JsonNode components = objectMapper.readTree(sbomService.generateCycloneDx(root)).path("components");
            if (!components.isArray()) {
                return List.of();
            }
            List<DependencyAsset> dependencies = new ArrayList<>();
            for (JsonNode component : components) {
                String name = component.path("name").asText("");
                if (name.isBlank()) {
                    continue;
                }
                String group = component.path("group").asText("");
                String coordinate = group.isBlank() ? name : group + ":" + name;
                dependencies.add(new DependencyAsset(
                        coordinate,
                        component.path("version").asText(""),
                        component.path("scope").asText(""),
                        component.path("purl").asText("")));
            }
            return dependencies.stream()
                    .sorted(Comparator.comparing(DependencyAsset::coordinate))
                    .toList();
        } catch (RuntimeException | IOException e) {
            omittedReasons.add("dependency inventory unavailable: " + safeMessage(e));
            return List.of();
        }
    }

    private List<AssetRiskSignal> detectRisks(
            String projectId,
            Path root,
            List<ClassifiedAssetFile> files,
            List<String> omittedReasons) {
        List<AssetRiskSignal> risks = new ArrayList<>();
        addCodeUnitRisk(
                risks, "PUBLIC_HTTP_ENTRY", "MEDIUM",
                loadCodeUnits(() -> graphQueryService.findEntryPoints(projectId), "entry points", omittedReasons),
                unit -> true, "public request entry points increase reachable attack surface");
        addCodeUnitRisk(
                risks, "DANGEROUS_SINK", "HIGH",
                loadCodeUnits(() -> graphDiagnosticsService.listScanTargets(projectId), "scan targets", omittedReasons),
                unit -> isDangerousSink(unit.rawSource()), "potential command, query, deserialization, or lookup sink");

        List<String> sensitiveFiles = files.stream()
                .filter(file -> file.category() != AssetFileCategory.GENERATED)
                .filter(file -> isSensitiveConfigCandidate(file.path()))
                .filter(file -> file.sizeBytes() <= MAX_HINT_FILE_BYTES)
                .filter(file -> containsSensitiveKey(readHintText(root.resolve(file.path()))))
                .map(ClassifiedAssetFile::path)
                .limit(20)
                .toList();
        if (!sensitiveFiles.isEmpty()) {
            risks.add(new AssetRiskSignal(
                    "SENSITIVE_CONFIG", "HIGH", sensitiveFiles.size(), sensitiveFiles,
                    "configuration contains secret-bearing key names; values are intentionally not exposed"));
        }

        try {
            List<VulnFinding> dependencyFindings = vulnStore.list(projectId, null, null).stream()
                    .filter(finding -> "DEP_VULNERABILITY".equals(finding.ruleId()))
                    .filter(finding -> !VulnFinding.FIXED.equals(finding.status())
                            && !VulnFinding.DISMISSED.equals(finding.status()))
                    .toList();
            if (!dependencyFindings.isEmpty()) {
                List<String> evidence = dependencyFindings.stream()
                        .map(finding -> finding.title().isBlank() ? finding.qualifiedName() : finding.title())
                        .filter(value -> value != null && !value.isBlank())
                        .limit(20)
                        .toList();
                risks.add(new AssetRiskSignal(
                        "DEPENDENCY_CVE", highestSeverity(dependencyFindings), dependencyFindings.size(), evidence,
                        "active dependency vulnerability findings are present"));
            }
        } catch (RuntimeException e) {
            omittedReasons.add("dependency vulnerability findings unavailable: " + safeMessage(e));
        }

        try {
            List<HotspotMetric> hotspots = gitChurnAnalyzer.topHotspots(projectId, 10);
            if (!hotspots.isEmpty()) {
                risks.add(new AssetRiskSignal(
                        "HIGH_CHURN_HOTSPOT", "MEDIUM", hotspots.size(),
                        hotspots.stream().map(HotspotMetric::filePath).toList(),
                        "frequently changed complex files warrant additional review"));
            }
        } catch (RuntimeException e) {
            omittedReasons.add("git hotspot analysis unavailable: " + safeMessage(e));
        }
        return List.copyOf(risks);
    }

    private List<CodeUnit> loadCodeUnits(
            CodeUnitLoader loader,
            String capability,
            List<String> omittedReasons) {
        try {
            return loader.load();
        } catch (RuntimeException e) {
            omittedReasons.add(capability + " unavailable: " + safeMessage(e));
            return List.of();
        }
    }

    private void addCodeUnitRisk(
            List<AssetRiskSignal> risks,
            String type,
            String severity,
            List<CodeUnit> units,
            Predicate<CodeUnit> predicate,
            String reason) {
        List<CodeUnit> matches = units.stream().filter(predicate).toList();
        if (!matches.isEmpty()) {
            risks.add(new AssetRiskSignal(
                    type,
                    severity,
                    matches.size(),
                    matches.stream().map(DefaultAssetProfileService::locationOf).distinct().limit(20).toList(),
                    reason));
        }
    }

    private List<ScannerPlanItem> buildScannerPlan(
            Set<String> languageNames,
            List<String> buildSystems,
            AssetProfileOptions options) {
        Set<String> languages = languageNames.stream()
                .map(value -> value.toLowerCase(Locale.ROOT))
                .collect(java.util.stream.Collectors.toSet());
        validateScannerOverrides(options);
        List<ScannerPlanItem> plan = new ArrayList<>();
        for (String scanner : SCANNERS) {
            ScannerDecision automatic = automaticDecision(scanner, languages, buildSystems);
            boolean selected = automatic.selected();
            String source = "AUTO";
            if (options.includeScanners().contains(scanner)) {
                selected = true;
                source = "INCLUDE_OVERRIDE";
            }
            if (options.excludeScanners().contains(scanner)) {
                selected = false;
                source = "EXCLUDE_OVERRIDE";
            }
            plan.add(new ScannerPlanItem(scanner, selected, source, automatic.reason()));
        }
        return List.copyOf(plan);
    }

    private void validateScannerOverrides(AssetProfileOptions options) {
        Set<String> unknown = new LinkedHashSet<>(options.includeScanners());
        unknown.addAll(options.excludeScanners());
        unknown.removeAll(SCANNERS);
        if (!unknown.isEmpty()) {
            throw new IllegalArgumentException("Unknown scanners: " + String.join(", ", unknown));
        }
    }

    private ScannerDecision automaticDecision(
            String scanner,
            Set<String> languages,
            List<String> buildSystems) {
        Set<String> broadLanguages = Set.of(
                "java", "kotlin", "c", "cpp", "python", "javascript", "typescript",
                "go", "php", "ruby", "solidity");
        Set<String> codeQlBuildlessLanguages = Set.of(
                "java", "kotlin", "python", "javascript", "typescript", "csharp", "ruby");
        return switch (scanner) {
            case "REPOGRAPH_CODE" -> decision(intersects(languages, Set.of("java", "c", "python")),
                    "supports indexed Java, C, and Python source");
            case "REPOGRAPH_TAINT" -> decision(languages.contains("java"),
                    "built-in conservative taint analysis currently targets Java");
            case "REPOGRAPH_PRECISE_TAINT" -> decision(
                    languages.contains("java")
                            && (buildSystems.contains("maven") || buildSystems.contains("gradle")),
                    "precise Java taint analysis requires Maven or Gradle context");
            case "SEMGREP" -> decision(intersects(languages, broadLanguages),
                    "lightweight rules cover the detected mainstream source languages");
            case "CODEQL" -> decision(intersects(languages, codeQlBuildlessLanguages),
                    "safe build-mode-none analysis supports the detected source languages");
            case "SLITHER" -> decision(languages.contains("solidity"),
                    "Slither is selected only for Solidity smart contracts");
            case "DEPENDENCY_CVE" -> decision(!buildSystems.isEmpty(),
                    "dependency scanning requires a recognized build manifest");
            default -> throw new IllegalArgumentException("Unsupported scanner: " + scanner);
        };
    }

    private static ScannerDecision decision(boolean selected, String applicableReason) {
        return new ScannerDecision(
                selected,
                selected ? applicableReason : "not applicable: " + applicableReason);
    }

    private static boolean isTestPath(String lowerPath, String fileName) {
        return containsSegment(lowerPath, Set.of("test", "tests", "__tests__", "spec"))
                || fileName.matches(".*(test|tests|spec)\\.[^.]+$")
                || fileName.endsWith("test.java") || fileName.endsWith("tests.java");
    }

    private static boolean isKnownBusinessFile(String name) {
        return name.equals("pom.xml")
                || name.equals("dockerfile")
                || name.equals("makefile")
                || name.equals("package.json")
                || name.equals("pyproject.toml")
                || name.startsWith("requirements")
                || name.startsWith("application.")
                || name.startsWith(".env");
    }

    private static String languageOf(String name, String extension) {
        return switch (extension) {
            case "java" -> "java";
            case "kt", "kts" -> "kotlin";
            case "c", "h" -> "c";
            case "cc", "cpp", "cxx", "hpp" -> "cpp";
            case "py" -> "python";
            case "js", "jsx" -> "javascript";
            case "ts", "tsx" -> "typescript";
            case "go" -> "go";
            case "rs" -> "rust";
            case "php" -> "php";
            case "rb" -> "ruby";
            case "swift" -> "swift";
            case "cs" -> "csharp";
            case "sol" -> "solidity";
            case "scala" -> "scala";
            case "groovy" -> "groovy";
            case "yml", "yaml" -> "yaml";
            case "xml" -> "xml";
            case "json" -> "json";
            case "toml" -> "toml";
            case "properties" -> "properties";
            default -> name.equals("dockerfile") ? "dockerfile" : "";
        };
    }

    private static String extensionOf(String name) {
        int separator = name.lastIndexOf('.');
        return separator < 0 || separator == name.length() - 1 ? "" : name.substring(separator + 1);
    }

    private static boolean containsSegment(String path, Set<String> candidates) {
        for (String segment : path.split("/")) {
            if (candidates.contains(segment)) {
                return true;
            }
        }
        return false;
    }

    private static Map<String, Long> distribution(
            List<ClassifiedAssetFile> files,
            java.util.function.Function<ClassifiedAssetFile, String> classifier) {
        Map<String, Long> counts = new LinkedHashMap<>();
        files.stream().map(classifier).sorted().forEach(key -> counts.merge(key, 1L, Long::sum));
        return counts;
    }

    private static String normalizePath(Path path) {
        return path.toString().replace('\\', '/');
    }

    private static String readHintText(Path path) {
        try {
            if (!Files.isRegularFile(path) || Files.size(path) > MAX_HINT_FILE_BYTES) {
                return "";
            }
            return Files.readString(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    private static boolean containsSensitiveKey(String content) {
        String lower = content.toLowerCase(Locale.ROOT);
        return lower.contains("password")
                || lower.contains("secret")
                || lower.contains("api_key")
                || lower.contains("api-key")
                || lower.contains("private_key")
                || lower.contains("private-key")
                || lower.contains("access_token")
                || lower.contains("auth_token");
    }

    private static boolean isSensitiveConfigCandidate(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        String name = Path.of(lower).getFileName().toString();
        String extension = extensionOf(name);
        return containsSegment(lower, Set.of("config", "configuration", "secrets"))
                || name.startsWith(".env")
                || name.startsWith("application.")
                || name.contains("credential")
                || name.contains("secret")
                || Set.of("yml", "yaml", "properties", "toml", "json", "xml").contains(extension);
    }

    private static boolean isDangerousSink(String source) {
        String lower = source == null ? "" : source.toLowerCase(Locale.ROOT);
        return lower.contains("runtime.getruntime().exec")
                || lower.contains("processbuilder")
                || lower.contains("executequery(")
                || lower.contains("executeupdate(")
                || lower.contains("readobject(")
                || lower.contains(".lookup(");
    }

    private static String locationOf(CodeUnit unit) {
        return unit.filePath() + ":" + Math.max(1, unit.startLine());
    }

    private static boolean intersects(Set<String> left, Set<String> right) {
        return left.stream().anyMatch(right::contains);
    }

    private static String highestSeverity(List<VulnFinding> findings) {
        List<String> order = List.of("CRITICAL", "HIGH", "MEDIUM", "LOW");
        return findings.stream()
                .map(VulnFinding::severity)
                .map(value -> value == null ? "LOW" : value.toUpperCase(Locale.ROOT))
                .min(Comparator.comparingInt(value -> {
                    int index = order.indexOf(value);
                    return index < 0 ? order.size() : index;
                }))
                .orElse("LOW");
    }

    private static String safeMessage(Exception exception) {
        return exception.getMessage() == null || exception.getMessage().isBlank()
                ? exception.getClass().getSimpleName()
                : exception.getMessage();
    }

    @FunctionalInterface
    private interface CodeUnitLoader {
        List<CodeUnit> load();
    }

    private record ScannerDecision(boolean selected, String reason) {}
}
