package com.repograph.authorization;

import com.repograph.core.authorization.AuthorizationConstraint;
import com.repograph.core.authorization.AuthorizationEvidence;
import com.repograph.core.authorization.AuthorizationEvidenceService;
import com.repograph.core.authorization.AuthorizationEvidenceStatus;
import com.repograph.core.authorization.AuthorizationScope;
import com.repograph.core.authorization.ResourceAccessEvidence;
import com.repograph.core.authorization.RouteEvidence;
import com.repograph.core.authorization.SourceCitation;
import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.model.CodeUnit;
import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 基于现有 Java/Spring 索引生成路由、鉴权和资源访问证据。
 *
 * <p>该服务不会把注解或过滤器配置解释为已验证的运行时策略。方法级鉴权注解按 Spring
 * 方法安全的就近声明规则覆盖类级候选；配置级策略仅在源码明确引用当前路由时，
 * 作为未验证候选返回。
 *
 * @author leolu
 */
@Service
public class SpringAuthorizationEvidenceService implements AuthorizationEvidenceService {

    private static final int MAX_METHODS = 200;
    private static final int MAX_DEPTH = 12;
    private static final int MAX_EXPRESSION_LENGTH = 500;
    private static final Set<String> MAPPING_ANNOTATIONS = Set.of(
            "RequestMapping", "GetMapping", "PostMapping", "PutMapping", "PatchMapping", "DeleteMapping");
    private static final Set<String> AUTHORIZATION_ANNOTATIONS = Set.of(
            "PreAuthorize", "PostAuthorize", "Secured", "RolesAllowed", "PermitAll", "DenyAll");
    private static final Pattern REQUEST_METHOD = Pattern.compile(
            "RequestMethod\\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)");
    private static final List<ResourcePattern> RESOURCE_PATTERNS = List.of(
            new ResourcePattern("DATABASE", "queryForObject", Pattern.compile("\\bqueryForObject\\s*\\(")),
            new ResourcePattern("DATABASE", "executeQuery", Pattern.compile("\\bexecuteQuery\\s*\\(")),
            new ResourcePattern("DATABASE", "executeUpdate", Pattern.compile("\\bexecuteUpdate\\s*\\(")),
            new ResourcePattern(
                    "DATABASE",
                    "repository.findBy",
                    Pattern.compile(
                            "\\b\\w*repository\\s*\\.\\s*findBy\\w*\\s*\\(",
                            Pattern.CASE_INSENSITIVE)),
            new ResourcePattern(
                    "DATABASE",
                    "repository.save",
                    Pattern.compile(
                            "\\b\\w*repository\\s*\\.\\s*save\\w*\\s*\\(",
                            Pattern.CASE_INSENSITIVE)),
            new ResourcePattern(
                    "FILE",
                    "Files API",
                    Pattern.compile("\\bFiles\\s*\\.\\s*(read|write|copy|move|delete)\\w*\\s*\\(")),
            new ResourcePattern("FILE", "file stream", Pattern.compile("\\b(FileInputStream|FileOutputStream)\\s*\\(")),
            new ResourcePattern("NETWORK", "HTTP client", Pattern.compile(
                    "\\b(RestTemplate|WebClient|HttpClient|URLConnection)\\b")),
            new ResourcePattern(
                    "DANGEROUS_SINK",
                    "Runtime.exec",
                    Pattern.compile("\\bRuntime\\s*\\.\\s*getRuntime\\s*\\(\\s*\\)"
                            + "\\s*\\.\\s*exec\\s*\\(")),
            new ResourcePattern("DANGEROUS_SINK", "ProcessBuilder", Pattern.compile("\\bnew\\s+ProcessBuilder\\s*\\(")),
            new ResourcePattern(
                    "DANGEROUS_SINK",
                    "ScriptEngine.eval",
                    Pattern.compile("\\b\\w*Engine\\s*\\.\\s*eval\\s*\\(")));
    private static final Pattern SECURITY_CONFIGURATION = Pattern.compile(
            "\\b(SecurityFilterChain|authorizeHttpRequests|authorizeRequests|requestMatchers|antMatchers)\\b");

    private final GraphQueryService graphQueryService;
    private final GraphDiagnosticsService graphDiagnosticsService;

    /**
     * 创建 Spring 鉴权证据服务。
     *
     * @param graphQueryService       图查询服务
     * @param graphDiagnosticsService 图批量诊断查询服务
     */
    public SpringAuthorizationEvidenceService(
            GraphQueryService graphQueryService,
            GraphDiagnosticsService graphDiagnosticsService) {
        this.graphQueryService = graphQueryService;
        this.graphDiagnosticsService = graphDiagnosticsService;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<AuthorizationEvidence> analyze(String projectId, int maxDepth) {
        if (projectId == null || projectId.isBlank()) {
            throw new IllegalArgumentException("projectId is required");
        }
        int safeDepth = Math.max(0, Math.min(maxDepth, MAX_DEPTH));
        List<CodeUnit> policyUnits = findPolicyUnits(projectId);
        return graphQueryService.findEntryPoints(projectId).stream()
                .filter(SpringAuthorizationEvidenceService::isSpringRoute)
                .map(entry -> analyzeRoute(projectId, entry, policyUnits, safeDepth))
                .sorted(Comparator.comparing(evidence -> evidence.route().handler()))
                .toList();
    }

    private AuthorizationEvidence analyzeRoute(
            String projectId,
            CodeUnit entry,
            List<CodeUnit> policyUnits,
            int maxDepth) {
        Optional<CodeUnit> owner = ownerOf(projectId, entry);
        RouteEvidence route = routeOf(entry, owner);
        List<AuthorizationConstraint> localConstraints = localConstraints(entry, owner);
        List<AuthorizationConstraint> constraints = new ArrayList<>(localConstraints);
        List<String> missingInfo = new ArrayList<>();
        AuthorizationEvidenceStatus status;

        if (!localConstraints.isEmpty()) {
            status = AuthorizationEvidenceStatus.LOCAL_CONSTRAINT_CANDIDATE;
        } else {
            List<AuthorizationConstraint> policyCandidates = policyCandidates(route.path(), policyUnits);
            constraints.addAll(policyCandidates);
            if (policyCandidates.isEmpty()) {
                status = AuthorizationEvidenceStatus.NO_LOCAL_EVIDENCE;
                missingInfo.add(
                        "No local authorization evidence was found; this does not prove unauthenticated access");
            } else {
                status = AuthorizationEvidenceStatus.POLICY_CANDIDATE;
                missingInfo.add("Static analysis cannot confirm the security configuration's route coverage");
            }
        }
        missingInfo.add("Runtime filter, gateway, proxy and external policy behavior was not evaluated");

        return new AuthorizationEvidence(
                projectId,
                route,
                status,
                constraints,
                resourceAccesses(projectId, entry, maxDepth),
                missingInfo);
    }

    private Optional<CodeUnit> ownerOf(String projectId, CodeUnit entry) {
        if (entry.parentQualifiedName() == null || entry.parentQualifiedName().isBlank()) {
            return Optional.empty();
        }
        return graphQueryService.findSymbol(entry.parentQualifiedName(), projectId);
    }

    private static RouteEvidence routeOf(CodeUnit entry, Optional<CodeUnit> owner) {
        String classPath = owner.map(SpringAuthorizationEvidenceService::mappingPath).orElse("");
        String methodPath = mappingPath(entry);
        return new RouteEvidence(
                combinePaths(classPath, methodPath),
                httpMethods(entry),
                entry.qualifiedName(),
                citation(entry));
    }

    private static List<AuthorizationConstraint> localConstraints(
            CodeUnit entry,
            Optional<CodeUnit> owner) {
        List<ConstraintDraft> classDrafts = owner.map(SpringAuthorizationEvidenceService::constraintDrafts)
                .orElseGet(List::of);
        List<ConstraintDraft> methodDrafts = constraintDrafts(entry);
        boolean methodOverrides = !methodDrafts.isEmpty();
        List<AuthorizationConstraint> result = new ArrayList<>();
        owner.ifPresent(unit -> classDrafts.forEach(draft -> result.add(
                draft.toConstraint(AuthorizationScope.CLASS, !methodOverrides, unit))));
        methodDrafts.forEach(draft -> result.add(
                draft.toConstraint(AuthorizationScope.METHOD, true, entry)));
        return result;
    }

    private static List<ConstraintDraft> constraintDrafts(CodeUnit unit) {
        List<ConstraintDraft> result = new ArrayList<>();
        for (String annotation : unit.annotations()) {
            String name = simpleAnnotationName(annotation);
            if (!AUTHORIZATION_ANNOTATIONS.contains(name)) {
                continue;
            }
            String expression = annotationValue(unit, name);
            result.add(new ConstraintDraft(name, expression));
        }
        return result;
    }

    private List<CodeUnit> findPolicyUnits(String projectId) {
        return graphDiagnosticsService.listScanTargets(projectId).stream()
                .filter(unit -> unit.rawSource() != null && SECURITY_CONFIGURATION.matcher(unit.rawSource()).find())
                .toList();
    }

    private static String annotationValue(CodeUnit unit, String simpleName) {
        String direct = unit.metadata().get("ann_" + simpleName);
        if (direct != null) {
            return direct;
        }
        return unit.metadata().entrySet().stream()
                .filter(entry -> entry.getKey().startsWith("ann_")
                        && simpleAnnotationName(entry.getKey().substring(4)).equals(simpleName))
                .map(java.util.Map.Entry::getValue)
                .findFirst()
                .orElseGet(() -> defaultExpression(simpleName));
    }

    private static List<AuthorizationConstraint> policyCandidates(String route, List<CodeUnit> policyUnits) {
        if (route == null || route.isBlank() || "/".equals(route)) {
            return List.of();
        }
        List<AuthorizationConstraint> result = new ArrayList<>();
        for (CodeUnit unit : policyUnits) {
            String source = unit.rawSource();
            if (source.contains("anyRequest()")
                    || source.contains("\"" + route + "\"")
                    || source.contains("'" + route + "'")) {
                result.add(new AuthorizationConstraint(
                        AuthorizationScope.CONFIGURATION,
                        "SecurityFilterChain",
                        compact(source),
                        false,
                        citation(unit)));
            }
        }
        return result;
    }

    private List<ResourceAccessEvidence> resourceAccesses(String projectId, CodeUnit entry, int maxDepth) {
        List<ResourceAccessEvidence> result = new ArrayList<>();
        Set<String> emitted = new LinkedHashSet<>();
        Set<String> visited = new HashSet<>();
        Deque<PathNode> queue = new ArrayDeque<>();
        queue.add(new PathNode(entry, List.of(entry)));

        while (!queue.isEmpty() && visited.size() < MAX_METHODS) {
            PathNode current = queue.removeFirst();
            if (!visited.add(current.unit().qualifiedName())) {
                continue;
            }
            detectResources(current, emitted, result);
            if (current.path().size() - 1 >= maxDepth) {
                continue;
            }
            for (CodeUnit callee : graphQueryService.findCallees(
                    current.unit().qualifiedName(), 1, projectId)) {
                if (!visited.contains(callee.qualifiedName())) {
                    List<CodeUnit> path = new ArrayList<>(current.path());
                    path.add(callee);
                    queue.addLast(new PathNode(callee, List.copyOf(path)));
                }
            }
        }
        return result;
    }

    private static void detectResources(
            PathNode node,
            Set<String> emitted,
            List<ResourceAccessEvidence> result) {
        String source = node.unit().rawSource();
        if (source == null || source.isBlank()) {
            return;
        }
        for (ResourcePattern pattern : RESOURCE_PATTERNS) {
            if (pattern.pattern().matcher(source).find()) {
                String key = pattern.kind() + "|" + pattern.target() + "|" + node.unit().qualifiedName();
                if (emitted.add(key)) {
                    result.add(new ResourceAccessEvidence(
                            pattern.kind(),
                            pattern.target(),
                            node.path().stream().map(CodeUnit::qualifiedName).toList(),
                            node.path().stream().map(SpringAuthorizationEvidenceService::citation).toList()));
                }
            }
        }
    }

    private static boolean isSpringRoute(CodeUnit unit) {
        if (!"java".equalsIgnoreCase(unit.language())) {
            return false;
        }
        return unit.annotations().stream()
                .map(SpringAuthorizationEvidenceService::simpleAnnotationName)
                .anyMatch(MAPPING_ANNOTATIONS::contains);
    }

    private static String mappingPath(CodeUnit unit) {
        for (String annotation : unit.annotations()) {
            String name = simpleAnnotationName(annotation);
            if (MAPPING_ANNOTATIONS.contains(name)) {
                String value = unit.metadata().get("ann_" + name);
                return firstAnnotationValue(value);
            }
        }
        return "";
    }

    private static List<String> httpMethods(CodeUnit unit) {
        LinkedHashSet<String> methods = new LinkedHashSet<>();
        for (String annotation : unit.annotations()) {
            switch (simpleAnnotationName(annotation)) {
                case "GetMapping" -> methods.add("GET");
                case "PostMapping" -> methods.add("POST");
                case "PutMapping" -> methods.add("PUT");
                case "PatchMapping" -> methods.add("PATCH");
                case "DeleteMapping" -> methods.add("DELETE");
                case "RequestMapping" -> {
                    Matcher matcher = REQUEST_METHOD.matcher(unit.rawSource() == null ? "" : unit.rawSource());
                    while (matcher.find()) {
                        methods.add(matcher.group(1));
                    }
                }
                default -> {
                    // 非路由注解不产生 HTTP 方法。
                }
            }
        }
        return List.copyOf(methods);
    }

    private static String combinePaths(String classPath, String methodPath) {
        String left = normalizePath(classPath);
        String right = normalizePath(methodPath);
        if ("/".equals(left)) {
            return right;
        }
        if ("/".equals(right)) {
            return left;
        }
        return left + right;
    }

    private static String normalizePath(String path) {
        if (path == null || path.isBlank()) {
            return "/";
        }
        String normalized = path.trim().replace('\\', '/');
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        while (normalized.length() > 1 && normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized.replaceAll("/{2,}", "/");
    }

    private static String firstAnnotationValue(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        String normalized = value.trim();
        if (normalized.startsWith("{") && normalized.endsWith("}")) {
            normalized = normalized.substring(1, normalized.length() - 1).trim();
        }
        int comma = normalized.indexOf(',');
        if (comma >= 0) {
            normalized = normalized.substring(0, comma).trim();
        }
        if ((normalized.startsWith("\"") && normalized.endsWith("\""))
                || (normalized.startsWith("'") && normalized.endsWith("'"))) {
            normalized = normalized.substring(1, normalized.length() - 1);
        }
        return normalized;
    }

    private static String simpleAnnotationName(String annotation) {
        String name = annotation.startsWith("@") ? annotation.substring(1) : annotation;
        int dot = name.lastIndexOf('.');
        return dot >= 0 ? name.substring(dot + 1) : name;
    }

    private static String defaultExpression(String annotation) {
        return switch (annotation) {
            case "PermitAll" -> "permitAll";
            case "DenyAll" -> "denyAll";
            default -> "";
        };
    }

    private static String compact(String source) {
        String compacted = source.replaceAll("\\s+", " ").trim();
        if (compacted.length() <= MAX_EXPRESSION_LENGTH) {
            return compacted;
        }
        return compacted.substring(0, MAX_EXPRESSION_LENGTH) + "...";
    }

    private static SourceCitation citation(CodeUnit unit) {
        return new SourceCitation(
                unit.qualifiedName(),
                unit.filePath(),
                unit.startLine(),
                unit.endLine());
    }

    private record ConstraintDraft(String annotation, String expression) {
        private AuthorizationConstraint toConstraint(
                AuthorizationScope scope,
                boolean effective,
                CodeUnit unit) {
            return new AuthorizationConstraint(scope, annotation, expression, effective, citation(unit));
        }
    }

    private record ResourcePattern(String kind, String target, Pattern pattern) {}

    private record PathNode(CodeUnit unit, List<CodeUnit> path) {}
}
