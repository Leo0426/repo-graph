package com.repograph.parser.java;

import com.github.javaparser.ast.NodeList;
import com.github.javaparser.ast.body.AnnotationDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.body.RecordDeclaration;
import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.expr.MemberValuePair;
import com.github.javaparser.ast.expr.NormalAnnotationExpr;
import com.github.javaparser.ast.expr.SingleMemberAnnotationExpr;
import com.github.javaparser.ast.nodeTypes.NodeWithAnnotations;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.ast.type.Type;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 静态辅助方法：FQN 构建、方法签名生成、注解提取等，供 {@link JavaCodeParser}、
 * {@link JavaTypeVisitor} 共享使用。
 */
final class JavaParserHelpers {

    static final Set<String> ENTRY_POINT_ANNOTATIONS = Set.of(
            "@RestController", "@Controller",
            "@GetMapping", "@PostMapping", "@PutMapping", "@DeleteMapping", "@RequestMapping",
            "@Path", "@GET", "@POST", "@PUT", "@DELETE"
    );

    static final Set<String> TEST_ANNOTATIONS = Set.of(
            "@Test", "@ParameterizedTest", "@RepeatedTest"
    );

    private JavaParserHelpers() {}

    // ── FQN builders ─────────────────────────────────────────────────────────

    static String buildTypeFqn(String packageName, ClassOrInterfaceDeclaration n) {
        Optional<String> javaParsedFqn = n.getFullyQualifiedName();
        if (javaParsedFqn.isPresent()) {
            return nestingNormalize(javaParsedFqn.get(), packageName);
        }
        String name = n.getNameAsString();
        return packageName.isEmpty() ? name : packageName + "." + name;
    }

    static String buildTypeFqnEnum(String packageName, EnumDeclaration n) {
        Optional<String> fqn = n.getFullyQualifiedName();
        if (fqn.isPresent()) return nestingNormalize(fqn.get(), packageName);
        return packageName.isEmpty() ? n.getNameAsString() : packageName + "." + n.getNameAsString();
    }

    static String buildTypeFqnRecord(String packageName, RecordDeclaration n) {
        Optional<String> fqn = n.getFullyQualifiedName();
        if (fqn.isPresent()) return nestingNormalize(fqn.get(), packageName);
        return packageName.isEmpty() ? n.getNameAsString() : packageName + "." + n.getNameAsString();
    }

    static String buildTypeFqnAnnotation(String packageName, AnnotationDeclaration n) {
        Optional<String> fqn = n.getFullyQualifiedName();
        if (fqn.isPresent()) return nestingNormalize(fqn.get(), packageName);
        return packageName.isEmpty() ? n.getNameAsString() : packageName + "." + n.getNameAsString();
    }

    /**
     * 将 JavaParser 返回的 FQN（内部类用 {@code .} 分隔）转换为 RepoGraph 规范（内部类用 {@code $} 分隔）。
     */
    static String nestingNormalize(String fqn, String packageName) {
        if (packageName.isEmpty()) {
            return fqn.replace('.', '$');
        }
        String prefix = packageName + ".";
        if (fqn.startsWith(prefix)) {
            String classPath = fqn.substring(prefix.length());
            return prefix + classPath.replace('.', '$');
        }
        return fqn;
    }

    static String buildMethodQn(String classFqn, MethodDeclaration n) {
        return classFqn + "#" + n.getNameAsString() + "(" + buildParamTypes(n.getParameters()) + ")";
    }

    static String stripGenericType(String type) {
        return type.replaceAll("<.*>", "");
    }

    static String buildConstructorQn(String classFqn, ConstructorDeclaration n) {
        String simpleName = classFqn.contains("$")
                ? classFqn.substring(classFqn.lastIndexOf('$') + 1)
                : classFqn.contains(".") ? classFqn.substring(classFqn.lastIndexOf('.') + 1) : classFqn;
        return classFqn + "#" + simpleName + "(" + buildParamTypes(n.getParameters()) + ")";
    }

    static String buildParamTypes(NodeList<Parameter> params) {
        return params.stream()
                .map(p -> {
                    String type = p.getType().asString().replaceAll("<.*>", "");
                    return p.isVarArgs() ? type + "..." : type;
                })
                .collect(Collectors.joining(","));
    }

    // ── Signature builders ────────────────────────────────────────────────────

    static String buildMethodSignature(MethodDeclaration n) {
        String mods = n.getModifiers().stream()
                .map(m -> m.getKeyword().asString()).collect(Collectors.joining(" "));
        String params = n.getParameters().stream()
                .map(p -> p.getType().asString() + " " + p.getNameAsString())
                .collect(Collectors.joining(", "));
        String base = (mods.isEmpty() ? "" : mods + " ")
                + n.getType().asString() + " "
                + n.getNameAsString() + "(" + params + ")";
        if (!n.getThrownExceptions().isEmpty()) {
            base += " throws " + n.getThrownExceptions().stream()
                    .map(Type::asString).collect(Collectors.joining(", "));
        }
        return base;
    }

    static String buildConstructorSignature(ConstructorDeclaration n) {
        String mods = n.getModifiers().stream()
                .map(m -> m.getKeyword().asString()).collect(Collectors.joining(" "));
        String params = n.getParameters().stream()
                .map(p -> p.getType().asString() + " " + p.getNameAsString())
                .collect(Collectors.joining(", "));
        return (mods.isEmpty() ? "" : mods + " ") + n.getNameAsString() + "(" + params + ")";
    }

    static String buildTypeSignature(ClassOrInterfaceDeclaration n) {
        String mods = n.getModifiers().stream()
                .map(m -> m.getKeyword().asString()).collect(Collectors.joining(" "));
        String keyword = n.isInterface() ? "interface" : "class";
        String base = (mods.isEmpty() ? "" : mods + " ") + keyword + " " + n.getNameAsString();
        if (!n.getExtendedTypes().isEmpty()) {
            base += " extends " + n.getExtendedTypes().stream()
                    .map(ClassOrInterfaceType::getNameAsString).collect(Collectors.joining(", "));
        }
        if (!n.getImplementedTypes().isEmpty()) {
            base += " implements " + n.getImplementedTypes().stream()
                    .map(ClassOrInterfaceType::getNameAsString).collect(Collectors.joining(", "));
        }
        return base;
    }

    static String buildRecordParamSignature(RecordDeclaration n) {
        String params = n.getParameters().stream()
                .map(p -> p.getType().asString() + " " + p.getNameAsString())
                .collect(Collectors.joining(", "));
        return "(" + params + ")";
    }

    // ── Annotation helpers ────────────────────────────────────────────────────

    static List<String> extractAnnotations(NodeWithAnnotations<?> node) {
        List<String> result = new ArrayList<>();
        for (AnnotationExpr ann : node.getAnnotations()) {
            result.add("@" + ann.getNameAsString());
        }
        return Collections.unmodifiableList(result);
    }

    static String extractVisibility(List<String> modifiers) {
        if (modifiers.contains("public")) return "public";
        if (modifiers.contains("protected")) return "protected";
        if (modifiers.contains("private")) return "private";
        return "package";
    }

    static Map<String, String> buildMethodMetadata(MethodDeclaration n) {
        Map<String, String> metadata = new LinkedHashMap<>();
        List<String> modifiers = n.getModifiers().stream()
                .map(m -> m.getKeyword().asString()).collect(Collectors.toList());
        metadata.put("visibility", extractVisibility(modifiers));
        if (n.isStatic()) metadata.put("is_static", "true");
        if (n.isAbstract()) metadata.put("is_abstract", "true");
        if (n.isFinal()) metadata.put("is_final", "true");
        metadata.put("return_type", n.getType().asString());
        String paramTypes = buildParamTypes(n.getParameters());
        if (!paramTypes.isEmpty()) metadata.put("param_types", paramTypes);
        return metadata;
    }

    static void applyEntryPoint(List<String> annotations, Map<String, String> metadata) {
        if (annotations.stream().anyMatch(ENTRY_POINT_ANNOTATIONS::contains)) {
            metadata.put("is_entry_point", "true");
        }
    }

    /**
     * 将注解的主要属性（value / path）写入 metadata，key 格式为 {@code ann_<AnnotationName>}。
     */
    static void applyAnnotationAttributes(NodeWithAnnotations<?> node, Map<String, String> metadata) {
        for (AnnotationExpr ann : node.getAnnotations()) {
            String name = ann.getNameAsString();
            if (ann instanceof SingleMemberAnnotationExpr sma) {
                String val = sma.getMemberValue().toString();
                if (val.startsWith("\"") && val.endsWith("\"")) val = val.substring(1, val.length() - 1);
                metadata.put("ann_" + name, val);
            } else if (ann instanceof NormalAnnotationExpr na) {
                for (MemberValuePair pair : na.getPairs()) {
                    String key = pair.getNameAsString();
                    if ("value".equals(key) || "path".equals(key)) {
                        String val = pair.getValue().toString();
                        if (val.startsWith("\"") && val.endsWith("\"")) val = val.substring(1, val.length() - 1);
                        metadata.put("ann_" + name, val);
                        break;
                    }
                }
            }
        }
    }

    // ── Misc ──────────────────────────────────────────────────────────────────

    static boolean isTestFile(String fileName) {
        return fileName.endsWith("Test.java")
                || fileName.endsWith("Tests.java")
                || fileName.endsWith("Spec.java");
    }

    /**
     * 从源代码字符串中按行号范围提取原始代码片段（1-based）。
     */
    static String extractSource(String source, int startLine, int endLine) {
        if (startLine <= 0 || endLine <= 0) return "";
        String[] lines = source.split("\n", -1);
        int from = Math.max(0, startLine - 1);
        int to = Math.min(lines.length, endLine);
        if (from >= to) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = from; i < to; i++) {
            if (i > from) sb.append('\n');
            sb.append(lines[i]);
        }
        return sb.toString();
    }
}
