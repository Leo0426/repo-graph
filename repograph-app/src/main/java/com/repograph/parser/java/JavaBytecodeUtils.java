package com.repograph.parser.java;

import com.repograph.core.model.CodeUnitKind;
import sootup.core.jimple.common.stmt.Stmt;
import sootup.core.model.Body;
import sootup.core.model.SootField;
import sootup.core.model.SootMethod;
import sootup.core.types.ClassType;
import sootup.core.types.Type;
import sootup.java.core.JavaSootClass;

import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 字节码解析静态工具：FQN 转换、可见性提取、签名构建。
 */
final class JavaBytecodeUtils {

    private JavaBytecodeUtils() {}

    // ── FQN / 名称工具 ────────────────────────────────────────────────────────

    static String classFileToFqn(Path classFile, Path classRoot) {
        try {
            Path relative = classRoot.relativize(classFile);
            String rel = relative.toString().replace('\\', '/');
            if (rel.endsWith(".class")) rel = rel.substring(0, rel.length() - 6);
            return rel.replace('/', '.');
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** 匿名类：FQN 中 $ 后紧跟数字，如 {@code com.example.Outer$1}。 */
    static boolean isAnonymousClass(String fqn) {
        int dollar = fqn.lastIndexOf('$');
        return dollar >= 0 && dollar + 1 < fqn.length() && Character.isDigit(fqn.charAt(dollar + 1));
    }

    /** 从 FQN 提取最内层简单名，处理内部类（{@code $} 分隔）。 */
    static String simpleNameOf(String fqn) {
        String part = fqn.contains(".") ? fqn.substring(fqn.lastIndexOf('.') + 1) : fqn;
        return part.contains("$") ? part.substring(part.lastIndexOf('$') + 1) : part;
    }

    // ── 签名构建 ──────────────────────────────────────────────────────────────

    static String buildClassSig(JavaSootClass cls, String simpleName) {
        StringBuilder sb = new StringBuilder();
        if (cls.isPublic()) sb.append("public ");
        if (cls.isAbstract() && !cls.isInterface()) sb.append("abstract ");
        if (cls.isFinal()) sb.append("final ");
        String keyword = cls.isInterface() ? "interface" : cls.isEnum() ? "enum" : "class";
        sb.append(keyword).append(' ').append(simpleName);
        cls.getSuperclass().ifPresent(sup -> {
            String s = sup.getFullyQualifiedName();
            if (!"java.lang.Object".equals(s)) sb.append(" extends ").append(sup.getClassName());
        });
        List<String> ifaceNames = cls.getInterfaces().stream()
                .map(ClassType::getClassName).sorted().collect(Collectors.toList());
        if (!ifaceNames.isEmpty()) {
            sb.append(cls.isInterface() ? " extends " : " implements ");
            sb.append(String.join(", ", ifaceNames));
        }
        return sb.toString();
    }

    static String methodSig(SootMethod method, String displayName) {
        StringBuilder sb = new StringBuilder();
        if (method.isPublic()) sb.append("public ");
        else if (method.isProtected()) sb.append("protected ");
        else if (method.isPrivate()) sb.append("private ");
        if (method.isStatic()) sb.append("static ");
        if (method.isFinal()) sb.append("final ");
        if (method.isAbstract()) sb.append("abstract ");
        if (!"<init>".equals(method.getName())) {
            sb.append(method.getReturnType()).append(' ');
        }
        sb.append(displayName).append('(');
        sb.append(method.getParameterTypes().stream().map(Type::toString)
                .collect(Collectors.joining(", ")));
        sb.append(')');
        return sb.toString();
    }

    static String fieldSig(SootField field) {
        StringBuilder sb = new StringBuilder();
        if (field.isPublic()) sb.append("public ");
        else if (field.isProtected()) sb.append("protected ");
        else if (field.isPrivate()) sb.append("private ");
        if (field.isStatic()) sb.append("static ");
        if (field.isFinal()) sb.append("final ");
        sb.append(field.getType()).append(' ').append(field.getName());
        return sb.toString();
    }

    // ── 可见性 ────────────────────────────────────────────────────────────────

    static String classVisibility(JavaSootClass cls) {
        if (cls.isPublic()) return "public";
        if (cls.isProtected()) return "protected";
        if (cls.isPrivate()) return "private";
        return "package";
    }

    static String methodVisibility(SootMethod m) {
        if (m.isPublic()) return "public";
        if (m.isProtected()) return "protected";
        if (m.isPrivate()) return "private";
        return "package";
    }

    static String fieldVisibility(SootField f) {
        if (f.isPublic()) return "public";
        if (f.isProtected()) return "protected";
        if (f.isPrivate()) return "private";
        return "package";
    }

    // ── 杂项工具 ──────────────────────────────────────────────────────────────

    static CodeUnitKind resolveClassKind(JavaSootClass cls) {
        if (cls.isInterface()) return CodeUnitKind.INTERFACE;
        if (cls.isEnum()) return CodeUnitKind.ENUM;
        return CodeUnitKind.CLASS;
    }

    static int[] lineRangeOf(Body body) {
        int start = Integer.MAX_VALUE;
        int end = 0;
        for (Stmt stmt : body.getStmts()) {
            int line = stmtLine(stmt);
            if (line > 0) {
                if (line < start) start = line;
                if (line > end) end = line;
            }
        }
        return start == Integer.MAX_VALUE ? new int[]{0, 0} : new int[]{start, end};
    }

    static int stmtLine(Stmt stmt) {
        try {
            return stmt.getPositionInfo().getStmtPosition().getFirstLine();
        } catch (Exception e) {
            return 0;
        }
    }
}
