package com.repograph.parser.java;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.RelationEdge;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.util.PathUtil;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.ImportDeclaration;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 单文件解析的可变状态容器，贯穿 {@link JavaTypeVisitor} 遍历全程。
 */
final class JavaParseContext {

    final String source;
    final String relativePath;
    final String projectId;
    final Path projectRoot;
    final boolean isTestFile;
    final Map<String, String> localSymbolIds;

    final List<CodeUnit> units = new ArrayList<>();
    final List<RelationEdge> edges = new ArrayList<>();

    final Deque<String> classStack = new ArrayDeque<>();
    final Deque<String> methodStack = new ArrayDeque<>();

    String packageName = "";
    /** simple name → FQN (for type resolution) */
    final Map<String, String> importMap = new HashMap<>();
    /** static member simple name → FQN (for static import resolution) */
    final Map<String, String> staticImportMap = new HashMap<>();
    /** Owners imported through {@code import static Type.*}; only unique-owner calls are resolved. */
    final Set<String> staticWildcardOwners = new LinkedHashSet<>();
    /**
     * Field name → declared type FQN (class scope). Populated in visit(FieldDeclaration),
     * never cleared — fields are visible throughout the class.
     */
    final Map<String, String> fieldTypeMap = new HashMap<>();
    /** Field name → source-level declared type used for overload matching. */
    final Map<String, String> fieldValueTypeMap = new HashMap<>();
    /**
     * Parameter/local variable name → declared type FQN (method scope). Reset at each
     * method/constructor entry to prevent stale locals from leaking into sibling methods.
     * Takes precedence over fieldTypeMap when a local variable shadows a field.
     */
    Map<String, String> methodVarMap = new HashMap<>();
    /** Parameter/local name → source-level declared type used for overload matching. */
    Map<String, String> methodValueTypeMap = new HashMap<>();
    /**
     * {@code classFqn#simpleName} → return type FQN. Populated in visit(MethodDeclaration)
     * for non-void, non-primitive return types. Used by resolveExprType to follow chained
     * calls like {@code a.getB().doC()} when getB() is defined in the same file.
     */
    final Map<String, String> returnTypeByBase = new HashMap<>();
    /** Type FQN → directly extended type FQNs for same-file inherited call resolution. */
    final Map<String, List<String>> directSuperTypes = new HashMap<>();
    /**
     * Type FQN → 是否实现了框架回调接口（{@link JavaParserHelpers#FRAMEWORK_CALLBACK_INTERFACES}）。
     * 供 {@code @Override} 方法补充 is_entry_point 判断，覆盖注解式入口检测不到的框架回调场景。
     */
    final Map<String, Boolean> classImplementsCallbackInterface = new HashMap<>();

    JavaParseContext(String source, String relativePath, String projectId, Path projectRoot,
                     boolean isTestFile, Map<String, String> localSymbolIds) {
        this.source = source;
        this.relativePath = relativePath;
        this.projectId = projectId;
        this.projectRoot = projectRoot;
        this.isTestFile = isTestFile;
        this.localSymbolIds = localSymbolIds;
    }

    /**
     * 在 visitor 运行前调用，建立 simpleName→FQN 映射供类型解析使用。
     * 同时收集静态导入的成员名到 staticImportMap。
     */
    void initImports(CompilationUnit cu) {
        for (ImportDeclaration imp : cu.getImports()) {
            String importFqn = imp.getNameAsString();
            if (imp.isStatic() && imp.isAsterisk()) {
                staticWildcardOwners.add(importFqn);
                continue;
            }
            if (imp.isAsterisk()) continue;
            String simpleName = importFqn.contains(".")
                    ? importFqn.substring(importFqn.lastIndexOf('.') + 1)
                    : importFqn;
            if (imp.isStatic()) {
                int memberSeparator = importFqn.lastIndexOf('.');
                String owner = memberSeparator < 0
                        ? ""
                        : importFqn.substring(0, memberSeparator);
                staticImportMap.put(simpleName, owner + "#" + simpleName);
            } else {
                importMap.put(simpleName, importFqn);
            }
        }
    }

    /**
     * 在 visitor 运行后调用，产出 IMPORTS 边。
     */
    void processImportEdges(CompilationUnit cu) {
        for (ImportDeclaration imp : cu.getImports()) {
            if (imp.isAsterisk() || imp.isStatic() || projectRoot == null) continue;
            String importFqn = imp.getNameAsString();
            String relativeFqnPath = importFqn.replace('.', '/') + ".java";
            Optional<Path> target = findJavaFile(projectRoot, relativeFqnPath);
            int line = imp.getBegin().map(p -> p.line).orElse(0);
            if (target.isPresent()) {
                String targetRelPath = PathUtil.toRelativePath(projectRoot, target.get());
                edges.add(new RelationEdge(relativePath, targetRelPath,
                        EdgeKind.IMPORTS, true, relativePath, line));
            } else {
                edges.add(new RelationEdge(relativePath, importFqn,
                        EdgeKind.IMPORTS, false, relativePath, line));
            }
        }
    }

    private Optional<Path> findJavaFile(Path root, String relativeFqnPath) {
        try (Stream<Path> walk = Files.walk(root, 10)) {
            return walk.filter(p -> p.toString().replace('\\', '/').endsWith(relativeFqnPath))
                    .findFirst();
        } catch (IOException e) {
            return Optional.empty();
        }
    }

    /**
     * 将方法调用的 scope（接收者表达式字符串）解析为其声明类型的 FQN。
     */
    String resolveScope(String scope) {
        if (scope == null || scope.isEmpty()) return null;
        if ("this".equals(scope) && !classStack.isEmpty()) return classStack.peek();
        String varType = methodVarMap.get(scope);
        if (varType != null) return varType;
        varType = fieldTypeMap.get(scope);
        if (varType != null) return varType;
        String imported = importMap.get(scope);
        if (imported != null) return imported;
        if (scope.contains(".")) return scope.substring(0, scope.lastIndexOf('.'));
        // 不是变量/字段/显式 import，且形如类型名（首字母大写）：猜测为同包静态调用的接收者
        // （Java 同包类无需 import）。猜错时下游按 targetBase+arity 匹配不到候选，边被静默丢弃，
        // 不会产生错误连边——比回退到"当作调用方自身类的方法"更安全。
        if (!packageName.isEmpty() && Character.isUpperCase(scope.charAt(0))) {
            return packageName + "." + scope;
        }
        return null;
    }

    /**
     * 将简单类型名解析为全限定名（尽力而为）。
     */
    String resolveType(String simpleName) {
        if (simpleName.contains(".")) return simpleName;
        String imported = importMap.get(simpleName);
        if (imported != null) return imported;
        if (!classStack.isEmpty()) {
            String nestedType = classStack.peek() + "$" + simpleName;
            if (localSymbolIds.containsKey(nestedType)) return nestedType;
        }
        if (!packageName.isEmpty()) return packageName + "." + simpleName;
        return simpleName;
    }

    /**
     * Resolve a method call when the receiver type is already known as a FQN.
     * Looks up same-file candidates first; falls back to {@code receiverTypeFqn#methodName}.
     */
    String resolveCallByType(String methodName, String receiverTypeFqn, int argCount) {
        if (argCount < 0) {
            String prefix = receiverTypeFqn + "#" + methodName;
            List<String> candidates = localSymbolIds.keySet().stream()
                    .filter(qn -> qn.startsWith(prefix + "(") || qn.equals(prefix))
                    .toList();
            return candidates.size() == 1 ? candidates.get(0) : prefix;
        }
        return resolveCallByType(methodName, receiverTypeFqn, unknownArgumentTypes(argCount));
    }

    /**
     * Resolve a method call by receiver type and conservatively inferred argument types.
     */
    String resolveCallByType(String methodName, String receiverTypeFqn, List<String> argumentTypes) {
        String prefix = receiverTypeFqn + "#" + methodName;
        List<String> candidates = localSymbolIds.keySet().stream()
                .filter(qn -> qn.startsWith(prefix + "(") || qn.equals(prefix))
                .collect(Collectors.toList());
        int argCount = argumentTypes.size();
        if (candidates.size() > 1 && hasCompleteArgumentTypes(argumentTypes)) {
            List<String> byType = candidates.stream()
                    .filter(qn -> matchesArgumentTypes(qn, argumentTypes))
                    .collect(Collectors.toList());
            if (byType.size() == 1) return byType.get(0);
        }
        if (candidates.size() > 1) {
            List<String> byArity = candidates.stream()
                    .filter(qn -> countParams(qn) == argCount)
                    .collect(Collectors.toList());
            if (byArity.size() == 1) return byArity.get(0);
            if (!byArity.isEmpty()) candidates = byArity;
        }
        if (candidates.size() == 1) return candidates.get(0);
        return unresolvedCallTarget(prefix, argumentTypes);
    }

    /**
     * 尝试将方法调用解析为已知符号的全限定名。
     * argCount=-1 表示参数个数未知（方法引用场景）。
     */
    String resolveCall(String methodName, String scope, int argCount) {
        if (argCount < 0) {
            if (scope == null || scope.isEmpty()) {
                String staticImported = staticImportMap.get(methodName);
                if (staticImported != null) return staticImported;
            }
            String resolvedScope = resolveScope(scope);
            if (resolvedScope != null) {
                return resolveCallByType(methodName, resolvedScope, -1);
            }
            if (!classStack.isEmpty()) return classStack.peek() + "#" + methodName;
            return methodName;
        }
        return resolveCall(methodName, scope, unknownArgumentTypes(argCount));
    }

    /**
     * Resolve a method call using receiver scope and conservatively inferred argument types.
     */
    String resolveCall(String methodName, String scope, List<String> argumentTypes) {
        if (scope == null || scope.isEmpty()) {
            String staticImported = staticImportMap.get(methodName);
            if (staticImported != null) {
                return unresolvedCallTarget(staticImported, argumentTypes);
            }
            if (staticWildcardOwners.size() == 1) {
                String owner = staticWildcardOwners.iterator().next();
                return unresolvedCallTarget(owner + "#" + methodName, argumentTypes);
            }
        }

        List<String> candidates = new ArrayList<>();
        for (String qn : localSymbolIds.keySet()) {
            if (!qn.contains("#")) continue;
            String afterHash = qn.substring(qn.indexOf('#') + 1);
            String simpleMethod = afterHash.contains("(")
                    ? afterHash.substring(0, afterHash.indexOf('('))
                    : afterHash;
            if (simpleMethod.equals(methodName)) {
                candidates.add(qn);
            }
        }

        if (!candidates.isEmpty()) {
            if ((scope == null || scope.isEmpty()) && !classStack.isEmpty()) {
                Set<String> receiverTypes = hierarchyOf(classStack.peek());
                List<String> inherited = candidates.stream()
                        .filter(qn -> receiverTypes.contains(ownerType(qn)))
                        .collect(Collectors.toList());
                if (!inherited.isEmpty()) candidates = inherited;
            }
            if (scope != null && !scope.isEmpty()) {
                String resolvedScope = resolveScope(scope);
                if (resolvedScope != null) {
                    List<String> scoped = candidates.stream()
                            .filter(qn -> qn.startsWith(resolvedScope + "#"))
                            .collect(Collectors.toList());
                    if (!scoped.isEmpty()) candidates = scoped;
                }
            }
            if (candidates.size() > 1 && hasCompleteArgumentTypes(argumentTypes)) {
                List<String> byType = candidates.stream()
                        .filter(qn -> matchesArgumentTypes(qn, argumentTypes))
                        .collect(Collectors.toList());
                if (byType.size() == 1) return byType.get(0);
            }
            if (candidates.size() > 1) {
                List<String> byArity = candidates.stream()
                        .filter(qn -> countParams(qn) == argumentTypes.size())
                        .collect(Collectors.toList());
                if (byArity.size() == 1) return byArity.get(0);
                if (!byArity.isEmpty()) candidates = byArity;
            }
            if (candidates.size() == 1) return candidates.get(0);
        }

        if (scope != null && !scope.isEmpty()) {
            String resolvedScope = resolveScope(scope);
            if (resolvedScope != null) {
                return unresolvedCallTarget(resolvedScope + "#" + methodName, argumentTypes);
            }
        }
        if (!classStack.isEmpty()) {
            return unresolvedCallTarget(classStack.peek() + "#" + methodName, argumentTypes);
        }
        return unresolvedCallTarget(methodName, argumentTypes);
    }

    // ── Private static utilities ──────────────────────────────────────────────

    private static String unresolvedCallTarget(String baseQualifiedName, int argCount) {
        return argCount < 0 ? baseQualifiedName : baseQualifiedName + "::arity=" + argCount;
    }

    private static String unresolvedCallTarget(String baseQualifiedName, List<String> argumentTypes) {
        if (hasCompleteArgumentTypes(argumentTypes)) {
            return baseQualifiedName + "(" + String.join(",", argumentTypes) + ")";
        }
        return unresolvedCallTarget(baseQualifiedName, argumentTypes.size());
    }

    private static List<String> unknownArgumentTypes(int argCount) {
        if (argCount < 0) return List.of();
        return Collections.nCopies(argCount, null);
    }

    private static boolean hasCompleteArgumentTypes(List<String> argumentTypes) {
        return argumentTypes.stream().allMatch(type -> type != null && !type.isBlank());
    }

    private static boolean matchesArgumentTypes(String qualifiedName, List<String> argumentTypes) {
        int open = qualifiedName.indexOf('(');
        int close = qualifiedName.lastIndexOf(')');
        if (open < 0 || close <= open) return argumentTypes.isEmpty();
        String params = qualifiedName.substring(open + 1, close).trim();
        List<String> parameterTypes = params.isEmpty()
                ? List.of()
                : Stream.of(params.split(",")).map(String::trim).toList();
        if (parameterTypes.size() != argumentTypes.size()) return false;
        for (int i = 0; i < parameterTypes.size(); i++) {
            if (!normalizeTypeName(parameterTypes.get(i))
                    .equals(normalizeTypeName(argumentTypes.get(i)))) {
                return false;
            }
        }
        return true;
    }

    private static String normalizeTypeName(String type) {
        String normalized = JavaParserHelpers.stripGenericType(type).replace("...", "[]").replace(" ", "");
        int arrayIndex = normalized.indexOf('[');
        String suffix = arrayIndex >= 0 ? normalized.substring(arrayIndex) : "";
        String base = arrayIndex >= 0 ? normalized.substring(0, arrayIndex) : normalized;
        int lastDot = base.lastIndexOf('.');
        if (lastDot >= 0) base = base.substring(lastDot + 1);
        return base + suffix;
    }

    private static int countParams(String qn) {
        int open = qn.indexOf('(');
        int close = qn.lastIndexOf(')');
        if (open < 0 || close <= open) return -1;
        String params = qn.substring(open + 1, close).trim();
        return params.isEmpty() ? 0 : params.split(",").length;
    }

    private Set<String> hierarchyOf(String typeFqn) {
        Set<String> hierarchy = new LinkedHashSet<>();
        collectHierarchy(typeFqn, hierarchy);
        return hierarchy;
    }

    private void collectHierarchy(String typeFqn, Set<String> hierarchy) {
        if (!hierarchy.add(typeFqn)) return;
        directSuperTypes.getOrDefault(typeFqn, List.of())
                .forEach(parent -> collectHierarchy(parent, hierarchy));
    }

    private static String ownerType(String qualifiedName) {
        int separator = qualifiedName.indexOf('#');
        return separator < 0 ? qualifiedName : qualifiedName.substring(0, separator);
    }
}
