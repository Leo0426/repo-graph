package com.repograph.parser.java;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.model.RelationEdge;
import com.repograph.core.util.CodeUnitIdUtil;
import com.github.javaparser.ast.body.AnnotationDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.FieldDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.body.RecordDeclaration;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.BooleanLiteralExpr;
import com.github.javaparser.ast.expr.CastExpr;
import com.github.javaparser.ast.expr.CharLiteralExpr;
import com.github.javaparser.ast.expr.DoubleLiteralExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.IntegerLiteralExpr;
import com.github.javaparser.ast.expr.LongLiteralExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.MethodReferenceExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.NullLiteralExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.expr.ThisExpr;
import com.github.javaparser.ast.expr.VariableDeclarationExpr;
import com.github.javaparser.ast.stmt.ExplicitConstructorInvocationStmt;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.ast.type.Type;
import com.github.javaparser.ast.visitor.VoidVisitorAdapter;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

import static com.repograph.parser.java.JavaParserHelpers.*;

/**
 * AST 访问者：遍历 Java 编译单元，提取 {@link CodeUnit} 和 {@link RelationEdge}，
 * 结果写入 {@link JavaParseContext}。
 */
final class JavaTypeVisitor extends VoidVisitorAdapter<JavaParseContext> {

    @Override
    public void visit(ClassOrInterfaceDeclaration n, JavaParseContext ctx) {
        CodeUnitKind kind = n.isInterface() ? CodeUnitKind.INTERFACE : CodeUnitKind.CLASS;
        String fqn = buildTypeFqn(ctx.packageName, n);
        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.relativePath, kind, fqn);

        Map<String, String> metadata = new LinkedHashMap<>();
        String visibility = extractVisibility(n.getModifiers().stream()
                .map(m -> m.getKeyword().asString()).collect(Collectors.toList()));
        metadata.put("visibility", visibility);
        if (n.isAbstract()) metadata.put("is_abstract", "true");
        if (n.isFinal()) metadata.put("is_final", "true");
        if (n.isStatic()) metadata.put("is_static", "true");

        List<String> annotations = extractAnnotations(n);
        applyEntryPoint(annotations, metadata);
        applyAnnotationAttributes(n, metadata);

        String parentQn = ctx.classStack.isEmpty() ? null : ctx.classStack.peek();
        String signature = buildTypeSignature(n);
        int start = n.getBegin().map(p -> p.line).orElse(0);
        int end = n.getEnd().map(p -> p.line).orElse(0);
        String rawSource = extractSource(ctx.source, start, end);

        CodeUnit unit = new CodeUnit(id, kind, "java", fqn, n.getNameAsString(),
                ctx.relativePath, start, end, rawSource, signature,
                annotations, parentQn, metadata);
        ctx.units.add(unit);

        if (parentQn != null) {
            String parentId = ctx.localSymbolIds.getOrDefault(parentQn, parentQn);
            ctx.edges.add(new RelationEdge(parentId, id, EdgeKind.CONTAINS, true, ctx.relativePath, start));
        }

        List<String> directSuperTypes = new ArrayList<>();
        for (ClassOrInterfaceType ext : n.getExtendedTypes()) {
            String targetFqn = ctx.resolveType(ext.getNameAsString());
            directSuperTypes.add(targetFqn);
            String targetId = ctx.localSymbolIds.getOrDefault(targetFqn, targetFqn);
            boolean resolved = ctx.localSymbolIds.containsKey(targetFqn);
            ctx.edges.add(new RelationEdge(id, targetId, EdgeKind.EXTENDS, resolved, ctx.relativePath, start));
        }
        ctx.directSuperTypes.put(fqn, List.copyOf(directSuperTypes));
        boolean implementsCallbackInterface = false;
        for (ClassOrInterfaceType impl : n.getImplementedTypes()) {
            String targetFqn = ctx.resolveType(impl.getNameAsString());
            String targetId = ctx.localSymbolIds.getOrDefault(targetFqn, targetFqn);
            boolean resolved = ctx.localSymbolIds.containsKey(targetFqn);
            ctx.edges.add(new RelationEdge(id, targetId, EdgeKind.IMPLEMENTS, resolved, ctx.relativePath, start));
            if (JavaParserHelpers.FRAMEWORK_CALLBACK_INTERFACES.contains(impl.getNameAsString())) {
                implementsCallbackInterface = true;
            }
        }
        ctx.classImplementsCallbackInterface.put(fqn, implementsCallbackInterface);

        ctx.classStack.push(fqn);
        super.visit(n, ctx);
        ctx.classStack.pop();
    }

    @Override
    public void visit(EnumDeclaration n, JavaParseContext ctx) {
        String fqn = buildTypeFqnEnum(ctx.packageName, n);
        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.relativePath, CodeUnitKind.ENUM, fqn);

        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("visibility", extractVisibility(n.getModifiers().stream()
                .map(m -> m.getKeyword().asString()).collect(Collectors.toList())));

        List<String> annotations = extractAnnotations(n);
        String parentQn = ctx.classStack.isEmpty() ? null : ctx.classStack.peek();
        int start = n.getBegin().map(p -> p.line).orElse(0);
        int end = n.getEnd().map(p -> p.line).orElse(0);

        CodeUnit unit = new CodeUnit(id, CodeUnitKind.ENUM, "java", fqn, n.getNameAsString(),
                ctx.relativePath, start, end, extractSource(ctx.source, start, end),
                "enum " + n.getNameAsString(), annotations, parentQn, metadata);
        ctx.units.add(unit);

        if (parentQn != null) {
            String parentId = ctx.localSymbolIds.getOrDefault(parentQn, parentQn);
            ctx.edges.add(new RelationEdge(parentId, id, EdgeKind.CONTAINS, true, ctx.relativePath, start));
        }

        ctx.classStack.push(fqn);
        super.visit(n, ctx);
        ctx.classStack.pop();
    }

    @Override
    public void visit(AnnotationDeclaration n, JavaParseContext ctx) {
        String fqn = buildTypeFqnAnnotation(ctx.packageName, n);
        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.relativePath, CodeUnitKind.ANNOTATION, fqn);

        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("visibility", extractVisibility(n.getModifiers().stream()
                .map(m -> m.getKeyword().asString()).collect(Collectors.toList())));

        String parentQn = ctx.classStack.isEmpty() ? null : ctx.classStack.peek();
        int start = n.getBegin().map(p -> p.line).orElse(0);
        int end = n.getEnd().map(p -> p.line).orElse(0);

        CodeUnit unit = new CodeUnit(id, CodeUnitKind.ANNOTATION, "java", fqn, n.getNameAsString(),
                ctx.relativePath, start, end, extractSource(ctx.source, start, end),
                "@interface " + n.getNameAsString(), List.of(), parentQn, metadata);
        ctx.units.add(unit);

        if (parentQn != null) {
            String parentId = ctx.localSymbolIds.getOrDefault(parentQn, parentQn);
            ctx.edges.add(new RelationEdge(parentId, id, EdgeKind.CONTAINS, true, ctx.relativePath, start));
        }

        ctx.classStack.push(fqn);
        super.visit(n, ctx);
        ctx.classStack.pop();
    }

    @Override
    public void visit(RecordDeclaration n, JavaParseContext ctx) {
        String fqn = buildTypeFqnRecord(ctx.packageName, n);
        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.relativePath, CodeUnitKind.CLASS, fqn);

        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("visibility", extractVisibility(n.getModifiers().stream()
                .map(m -> m.getKeyword().asString()).collect(Collectors.toList())));
        metadata.put("is_record", "true");

        List<String> annotations = extractAnnotations(n);
        applyEntryPoint(annotations, metadata);

        String parentQn = ctx.classStack.isEmpty() ? null : ctx.classStack.peek();
        int start = n.getBegin().map(p -> p.line).orElse(0);
        int end = n.getEnd().map(p -> p.line).orElse(0);

        String signature = "record " + n.getNameAsString() + buildRecordParamSignature(n);
        CodeUnit unit = new CodeUnit(id, CodeUnitKind.CLASS, "java", fqn, n.getNameAsString(),
                ctx.relativePath, start, end, extractSource(ctx.source, start, end),
                signature, annotations, parentQn, metadata);
        ctx.units.add(unit);

        if (parentQn != null) {
            String parentId = ctx.localSymbolIds.getOrDefault(parentQn, parentQn);
            ctx.edges.add(new RelationEdge(parentId, id, EdgeKind.CONTAINS, true, ctx.relativePath, start));
        }

        ctx.classStack.push(fqn);
        super.visit(n, ctx);
        ctx.classStack.pop();
    }

    @Override
    public void visit(MethodDeclaration n, JavaParseContext ctx) {
        if (ctx.classStack.isEmpty()) return;
        String classFqn = ctx.classStack.peek();
        String qn = buildMethodQn(classFqn, n);
        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.relativePath, CodeUnitKind.METHOD, qn);

        Map<String, String> metadata = buildMethodMetadata(n);
        if (ctx.isTestFile) metadata.put("is_test", "true");

        List<String> annotations = extractAnnotations(n);
        if (annotations.stream().anyMatch(TEST_ANNOTATIONS::contains)) {
            metadata.put("is_test", "true");
        }
        applyEntryPoint(annotations, metadata);
        // 注解式入口检测不到框架回调接口方法（如 HandlerInterceptor#preHandle、
        // AuthenticationProvider#authenticate）：框架直接调用它们，仓库内不会有显式调用方，
        // 只按调用方数量判断可达性会系统性漏判。用"@Override + 类实现已知回调接口"兜底识别。
        if (!"true".equals(metadata.get("is_entry_point"))
                && annotations.contains("@Override")
                && ctx.classImplementsCallbackInterface.getOrDefault(classFqn, false)) {
            metadata.put("is_entry_point", "true");
        }
        applyAnnotationAttributes(n, metadata);

        int start = n.getBegin().map(p -> p.line).orElse(0);
        int end = n.getEnd().map(p -> p.line).orElse(0);

        for (Parameter param : n.getParameters()) {
            if (!param.getType().isPrimitiveType()) {
                String typeName = param.getType().asString().replaceAll("<.*>", "");
                String targetFqn = ctx.resolveType(typeName);
                ctx.edges.add(new RelationEdge(id, targetFqn, EdgeKind.DEFINES_TYPE,
                        ctx.localSymbolIds.containsKey(targetFqn), ctx.relativePath, start));
            }
        }
        Type returnType = n.getType();
        if (!returnType.isVoidType() && !returnType.isPrimitiveType()) {
            String typeName = returnType.asString().replaceAll("<.*>", "");
            if (!typeName.isEmpty()) {
                String targetFqn = ctx.resolveType(typeName);
                ctx.edges.add(new RelationEdge(id, targetFqn, EdgeKind.DEFINES_TYPE,
                        ctx.localSymbolIds.containsKey(targetFqn), ctx.relativePath, start));
            }
        }

        CodeUnit unit = new CodeUnit(id, CodeUnitKind.METHOD, "java", qn, n.getNameAsString(),
                ctx.relativePath, start, end, extractSource(ctx.source, start, end),
                buildMethodSignature(n), annotations, classFqn, metadata);
        ctx.units.add(unit);

        String classId = ctx.localSymbolIds.getOrDefault(classFqn, classFqn);
        ctx.edges.add(new RelationEdge(classId, id, EdgeKind.CONTAINS, true, ctx.relativePath, start));

        if (annotations.contains("@Override")) {
            ctx.edges.add(new RelationEdge(id, classFqn + "#" + n.getNameAsString(),
                    EdgeKind.OVERRIDES, false, ctx.relativePath, start));
        }

        Type retType = n.getType();
        if (!retType.isVoidType() && !retType.isPrimitiveType()) {
            String retTypeFqn = ctx.resolveType(retType.asString().replaceAll("<.*>", ""));
            ctx.returnTypeByBase.put(classFqn + "#" + n.getNameAsString(), retTypeFqn);
        }

        ctx.methodVarMap = new HashMap<>();
        ctx.methodValueTypeMap = new HashMap<>();
        for (Parameter param : n.getParameters()) {
            String declaredType = stripGenericType(param.getType().asString());
            ctx.methodValueTypeMap.put(param.getNameAsString(),
                    param.isVarArgs() ? declaredType + "[]" : declaredType);
            if (!param.getType().isPrimitiveType()) {
                ctx.methodVarMap.put(param.getNameAsString(),
                        ctx.resolveType(declaredType));
            }
        }

        ctx.methodStack.push(id);
        super.visit(n, ctx);
        ctx.methodStack.pop();
    }

    @Override
    public void visit(ConstructorDeclaration n, JavaParseContext ctx) {
        if (ctx.classStack.isEmpty()) return;
        String classFqn = ctx.classStack.peek();
        String qn = buildConstructorQn(classFqn, n);
        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.relativePath, CodeUnitKind.CONSTRUCTOR, qn);

        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("visibility", extractVisibility(n.getModifiers().stream()
                .map(m -> m.getKeyword().asString()).collect(Collectors.toList())));
        String paramTypes = buildParamTypes(n.getParameters());
        if (!paramTypes.isEmpty()) metadata.put("param_types", paramTypes);

        List<String> annotations = extractAnnotations(n);
        int start = n.getBegin().map(p -> p.line).orElse(0);
        int end = n.getEnd().map(p -> p.line).orElse(0);

        String sig = buildConstructorSignature(n);
        CodeUnit unit = new CodeUnit(id, CodeUnitKind.CONSTRUCTOR, "java", qn, n.getNameAsString(),
                ctx.relativePath, start, end, extractSource(ctx.source, start, end),
                sig, annotations, classFqn, metadata);
        ctx.units.add(unit);

        String classId = ctx.localSymbolIds.getOrDefault(classFqn, classFqn);
        ctx.edges.add(new RelationEdge(classId, id, EdgeKind.CONTAINS, true, ctx.relativePath, start));

        ctx.methodVarMap = new HashMap<>();
        ctx.methodValueTypeMap = new HashMap<>();
        for (Parameter param : n.getParameters()) {
            String declaredType = stripGenericType(param.getType().asString());
            ctx.methodValueTypeMap.put(param.getNameAsString(),
                    param.isVarArgs() ? declaredType + "[]" : declaredType);
            if (!param.getType().isPrimitiveType()) {
                ctx.methodVarMap.put(param.getNameAsString(),
                        ctx.resolveType(declaredType));
            }
        }

        ctx.methodStack.push(id);
        super.visit(n, ctx);
        ctx.methodStack.pop();
    }

    @Override
    public void visit(ExplicitConstructorInvocationStmt n, JavaParseContext ctx) {
        if (!ctx.methodStack.isEmpty() && !ctx.classStack.isEmpty() && n.isThis()) {
            String callerId = ctx.methodStack.peek();
            String classFqn = ctx.classStack.peek();
            int line = n.getBegin().map(p -> p.line).orElse(0);

            String simpleName = classFqn.contains("$")
                    ? classFqn.substring(classFqn.lastIndexOf('$') + 1)
                    : classFqn.contains(".") ? classFqn.substring(classFqn.lastIndexOf('.') + 1) : classFqn;

            String targetQn = ctx.resolveCallByType(simpleName, classFqn, n.getArguments().size());
            String targetId = ctx.localSymbolIds.getOrDefault(targetQn, targetQn);
            boolean resolved = ctx.localSymbolIds.containsKey(targetQn);
            if (!targetId.equals(callerId)) {
                ctx.edges.add(new RelationEdge(callerId, targetId, EdgeKind.CALLS, resolved, ctx.relativePath, line));
            }
        }
        super.visit(n, ctx);
    }

    @Override
    public void visit(FieldDeclaration n, JavaParseContext ctx) {
        if (ctx.classStack.isEmpty()) return;
        String classFqn = ctx.classStack.peek();
        String classId = ctx.localSymbolIds.getOrDefault(classFqn, classFqn);

        Map<String, String> baseMetadata = new LinkedHashMap<>();
        baseMetadata.put("visibility", extractVisibility(n.getModifiers().stream()
                .map(m -> m.getKeyword().asString()).collect(Collectors.toList())));
        if (n.isStatic()) baseMetadata.put("is_static", "true");
        if (n.isFinal()) baseMetadata.put("is_final", "true");

        List<String> annotations = extractAnnotations(n);
        applyAnnotationAttributes(n, baseMetadata);

        String declaredValueType = stripGenericType(n.getElementType().asString());
        n.getVariables().forEach(var ->
                ctx.fieldValueTypeMap.put(var.getNameAsString(), declaredValueType));
        if (!n.getElementType().isPrimitiveType()) {
            String fieldTypeFqn = ctx.resolveType(declaredValueType);
            n.getVariables().forEach(var -> ctx.fieldTypeMap.put(var.getNameAsString(), fieldTypeFqn));
        }

        for (VariableDeclarator var : n.getVariables()) {
            String qn = classFqn + "." + var.getNameAsString();
            String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.relativePath, CodeUnitKind.FIELD, qn);

            int start = var.getBegin().map(p -> p.line).orElse(n.getBegin().map(p -> p.line).orElse(0));
            int end = var.getEnd().map(p -> p.line).orElse(n.getEnd().map(p -> p.line).orElse(0));

            String typeName = n.getElementType().asString().replaceAll("<.*>", "");
            String sig = n.getModifiers().stream().map(m -> m.getKeyword().asString())
                    .collect(Collectors.joining(" "))
                    + " " + n.getElementType().asString() + " " + var.getNameAsString();

            CodeUnit unit = new CodeUnit(id, CodeUnitKind.FIELD, "java", qn, var.getNameAsString(),
                    ctx.relativePath, start, end, extractSource(ctx.source, start, end),
                    sig.trim(), annotations, classFqn, new LinkedHashMap<>(baseMetadata));
            ctx.units.add(unit);
            ctx.edges.add(new RelationEdge(classId, id, EdgeKind.CONTAINS, true, ctx.relativePath, start));

            if (!n.getElementType().isPrimitiveType() && !typeName.isEmpty()) {
                String targetFqn = ctx.resolveType(typeName);
                ctx.edges.add(new RelationEdge(id, targetFqn, EdgeKind.DEFINES_TYPE,
                        ctx.localSymbolIds.containsKey(targetFqn), ctx.relativePath, start));
            }

            var.getInitializer().ifPresent(init -> {
                ctx.methodStack.push(id);
                init.accept(this, ctx);
                ctx.methodStack.pop();
            });
        }
    }

    @Override
    public void visit(MethodCallExpr n, JavaParseContext ctx) {
        if (ctx.methodStack.isEmpty()) {
            super.visit(n, ctx);
            return;
        }
        String callerId = ctx.methodStack.peek();
        String calledName = n.getNameAsString();
        int line = n.getBegin().map(p -> p.line).orElse(0);

        String targetQn;
        List<String> argumentTypes = n.getArguments().stream()
                .map(argument -> inferArgumentType(argument, ctx))
                .toList();
        Optional<Expression> scopeOpt = n.getScope();
        if (scopeOpt.isPresent()) {
            String resolvedType = resolveExprType(scopeOpt.get(), ctx);
            if (resolvedType != null) {
                targetQn = ctx.resolveCallByType(calledName, resolvedType, argumentTypes);
            } else {
                targetQn = ctx.resolveCall(calledName, scopeOpt.get().toString(), argumentTypes);
            }
        } else {
            targetQn = ctx.resolveCall(calledName, null, argumentTypes);
        }

        String targetId = ctx.localSymbolIds.getOrDefault(targetQn, targetQn);
        boolean resolved = ctx.localSymbolIds.containsKey(targetQn);
        ctx.edges.add(new RelationEdge(callerId, targetId, EdgeKind.CALLS, resolved, ctx.relativePath, line));
        super.visit(n, ctx);
    }

    @Override
    public void visit(ObjectCreationExpr n, JavaParseContext ctx) {
        if (!ctx.methodStack.isEmpty()) {
            String callerId = ctx.methodStack.peek();
            String typeName = n.getType().getNameAsString();
            int line = n.getBegin().map(p -> p.line).orElse(0);

            String targetFqn = ctx.resolveType(typeName);
            String paramTypes = n.getArguments().stream()
                    .map(a -> "Object").collect(Collectors.joining(","));
            String ctorQn = targetFqn + "#<init>(" + paramTypes + ")";
            boolean resolved = ctx.localSymbolIds.containsKey(targetFqn);

            ctx.edges.add(new RelationEdge(callerId, ctorQn, EdgeKind.CALLS, resolved, ctx.relativePath, line));
        }
        super.visit(n, ctx);
    }

    @Override
    public void visit(VariableDeclarationExpr n, JavaParseContext ctx) {
        String declaredValueType = stripGenericType(n.getElementType().asString());
        n.getVariables().forEach(var ->
                ctx.methodValueTypeMap.put(var.getNameAsString(), declaredValueType));
        if (!n.getElementType().isPrimitiveType()) {
            String typeFqn = ctx.resolveType(declaredValueType);
            n.getVariables().forEach(var -> ctx.methodVarMap.put(var.getNameAsString(), typeFqn));
        }
        super.visit(n, ctx);
    }

    @Override
    public void visit(MethodReferenceExpr n, JavaParseContext ctx) {
        if (!ctx.methodStack.isEmpty()) {
            String callerId = ctx.methodStack.peek();
            String methodName = n.getIdentifier();
            int line = n.getBegin().map(p -> p.line).orElse(0);

            String resolvedType = resolveExprType(n.getScope(), ctx);
            String targetQn = resolvedType != null
                    ? ctx.resolveCallByType(methodName, resolvedType, -1)
                    : ctx.resolveCall(methodName, n.getScope().toString(), -1);
            boolean resolved = ctx.localSymbolIds.containsKey(targetQn);
            ctx.edges.add(new RelationEdge(callerId, targetQn, EdgeKind.CALLS, resolved, ctx.relativePath, line));
        }
        super.visit(n, ctx);
    }

    /**
     * Infer the declared type FQN of an AST expression. Handles simple variable names,
     * {@code this}, field access ({@code this.field}), and chained method calls
     * ({@code a.getB().doC()}) using {@code returnTypeByBase}. Returns {@code null}
     * when the type cannot be determined.
     */
    private static String resolveExprType(Expression expr, JavaParseContext ctx) {
        if (expr instanceof ThisExpr) {
            return ctx.classStack.isEmpty() ? null : ctx.classStack.peek();
        }
        if (expr instanceof NameExpr ne) {
            return ctx.resolveScope(ne.getNameAsString());
        }
        if (expr instanceof FieldAccessExpr fae) {
            if (fae.getScope() instanceof ThisExpr) {
                return ctx.fieldTypeMap.get(fae.getNameAsString());
            }
            return null;
        }
        if (expr instanceof MethodCallExpr mce) {
            String receiverType = mce.getScope()
                    .map(scope -> resolveExprType(scope, ctx))
                    .orElseGet(() -> ctx.classStack.isEmpty() ? null : ctx.classStack.peek());
            if (receiverType == null) return null;
            return ctx.returnTypeByBase.get(receiverType + "#" + mce.getNameAsString());
        }
        return null;
    }

    /**
     * Infer a conservative source-level type for an invocation argument.
     */
    private static String inferArgumentType(Expression expression, JavaParseContext ctx) {
        if (expression instanceof StringLiteralExpr) return "String";
        if (expression instanceof CharLiteralExpr) return "char";
        if (expression instanceof BooleanLiteralExpr) return "boolean";
        if (expression instanceof IntegerLiteralExpr) return "int";
        if (expression instanceof LongLiteralExpr) return "long";
        if (expression instanceof DoubleLiteralExpr literal) {
            String value = literal.getValue().toLowerCase(Locale.ROOT);
            return value.endsWith("f") ? "float" : "double";
        }
        if (expression instanceof ObjectCreationExpr creation) {
            return stripGenericType(creation.getType().asString());
        }
        if (expression instanceof CastExpr cast) {
            return stripGenericType(cast.getType().asString());
        }
        if (expression instanceof NameExpr name) {
            String type = ctx.methodValueTypeMap.get(name.getNameAsString());
            return type != null ? type : ctx.fieldValueTypeMap.get(name.getNameAsString());
        }
        if (expression instanceof FieldAccessExpr field && field.getScope() instanceof ThisExpr) {
            return ctx.fieldValueTypeMap.get(field.getNameAsString());
        }
        if (expression instanceof NullLiteralExpr) return null;
        return null;
    }
}
