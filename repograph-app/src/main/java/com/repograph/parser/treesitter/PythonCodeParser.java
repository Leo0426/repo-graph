package com.repograph.parser.treesitter;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.model.RelationEdge;
import com.repograph.core.parser.CodeParser;
import com.repograph.core.parser.ParseOptions; // parse() 方法签名所需
import com.repograph.core.parser.ParseResult;
import com.repograph.core.util.CodeUnitIdUtil;
import com.repograph.core.util.PathUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.treesitter.TSNode;
import org.treesitter.TSParser;
import org.treesitter.TSTree;
import org.treesitter.TreeSitterPython;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 基于 Tree-sitter 的 Python 语言精确解析器，产出 CodeUnit 列表和 RelationEdge 列表。
 *
 * <p>支持的节点类型：class_definition → CLASS，function_definition → METHOD，
 * async_function_definition → METHOD。支持 decorator 注解提取和类型注解提取。
 *
 * <p>qualifiedName 通过嵌套层级构造，如顶层类 {@code MyClass}，其方法为
 * {@code MyClass#my_method}（使用 {@code #} 分隔）。
 *
 * <p>若 native 库加载失败，记录 ERROR 日志并返回空结果，不抛出异常。
 *
 * @author leolu
 * @since 0.1.0
 */
@Component
public class PythonCodeParser implements CodeParser {

    private static final Logger log = LoggerFactory.getLogger(PythonCodeParser.class);

    private static final boolean NATIVE_AVAILABLE;

    static {
        boolean available = false;
        try {
            new TreeSitterPython();
            available = true;
        } catch (Throwable t) {
            log.error("Tree-sitter Python native library failed to load — Python parsing disabled. " +
                      "Cause: {}. All .py files will be skipped.", t.getMessage());
        }
        NATIVE_AVAILABLE = available;
    }

    @Override
    public boolean supports(String language) {
        return NATIVE_AVAILABLE && "python".equalsIgnoreCase(language);
    }

    @Override
    public ParseResult parse(Path file, ParseOptions options) {
        if (!NATIVE_AVAILABLE) return ParseResult.empty();

        String source;
        try {
            source = Files.readString(file);
        } catch (IOException e) {
            log.warn("Failed to read Python file '{}': {}", file, e.getMessage());
            return ParseResult.empty();
        }

        String filePath = resolveFilePath(file, options);
        byte[] sourceBytes = source.getBytes(StandardCharsets.UTF_8);

        TSParser parser = new TSParser();
        try {
            parser.setLanguage(new TreeSitterPython());
        } catch (Throwable t) {
            log.error("Failed to set Tree-sitter Python language: {}", t.getMessage());
            return ParseResult.empty();
        }

        TSTree tree = parser.parseString(null, source);
        if (tree == null) {
            log.warn("Tree-sitter returned null tree for '{}'", file);
            return ParseResult.empty();
        }

        TSNode root = tree.getRootNode();
        Path projectRoot = (options != null) ? options.projectRoot() : null;
        String projectId = options != null && options.projectId() != null ? options.projectId() : "";
        ParseContext ctx = new ParseContext(filePath, projectId, sourceBytes, projectRoot);
        walkChildren(root, null, null, ctx);

        return ParseResult.of(List.copyOf(ctx.units), List.copyOf(ctx.edges), "PythonCodeParser");
    }

    // ── 树遍历 ───────────────────────────────────────────────────────────────

    /**
     * 遍历 AST 子节点，递归处理类和函数定义。
     *
     * @param node           当前节点
     * @param enclosingClass 最近的封闭类名（顶层为 {@code null}）
     * @param enclosingId    最近的封闭 CodeUnit ID（顶层为 {@code null}）
     * @param ctx            解析上下文
     */
    private void walkChildren(TSNode node, String enclosingClass, String enclosingId, ParseContext ctx) {
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            TSNode child = node.getChild(i);
            if (child.isNull()) continue;
            switch (child.getType()) {
                case "class_definition" -> handleClass(child, enclosingClass, ctx);
                case "function_definition", "async_function_definition" ->
                    handleFunction(child, enclosingClass, enclosingId, ctx);
                case "decorated_definition" ->
                    handleDecoratedDefinition(child, enclosingClass, enclosingId, ctx);
                case "import_statement" -> handleImportStatement(child, ctx);
                case "import_from_statement" -> handleImportFromStatement(child, ctx);
                default -> { /* skip */ }
            }
        }
    }

    // ── 类 ───────────────────────────────────────────────────────────────────

    private void handleClass(TSNode node, String enclosingClass, ParseContext ctx) {
        TSNode nameNode = node.getChildByFieldName("name");
        if (nameNode == null || nameNode.isNull()) return;
        String simpleName = nodeText(nameNode, ctx);
        if (simpleName.isEmpty()) return;

        String qualName = enclosingClass != null ? enclosingClass + "." + simpleName : simpleName;
        int startLine = node.getStartPoint().getRow() + 1;
        int endLine = node.getEndPoint().getRow() + 1;

        List<String> annotations = extractDecorators(node, ctx);

        Map<String, String> meta = new HashMap<>();
        meta.put("visibility", "public");

        TSNode superclasses = node.getChildByFieldName("superclasses");
        if (superclasses != null && !superclasses.isNull()) {
            String bases = nodeText(superclasses, ctx).replaceAll("^\\(|\\)$", "").trim();
            if (!bases.isEmpty()) meta.put("bases", bases);
        }

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.CLASS, qualName);
        CodeUnit unit = new CodeUnit(
            id, CodeUnitKind.CLASS, "python",
            qualName, simpleName,
            ctx.filePath, startLine, endLine,
            nodeText(node, ctx), "class " + simpleName,
            annotations, enclosingClass, meta
        );
        ctx.units.add(unit);
        ctx.localClassIdByQn.put(qualName, id);
        ctx.localClassIdByQn.put(simpleName, id);  // 简单名称查找，用于 extends 关系

        // EXTENDS 边
        if (superclasses != null && !superclasses.isNull()) {
            for (int i = 0; i < superclasses.getChildCount(); i++) {
                TSNode child = superclasses.getChild(i);
                if (child.isNull()) continue;
                String ct = child.getType();
                if ("identifier".equals(ct) || "attribute".equals(ct)) {
                    String baseName = nodeText(child, ctx);
                    String targetId = ctx.localClassIdByQn.get(baseName);
                    if (targetId != null) {
                        ctx.edges.add(new RelationEdge(id, targetId, EdgeKind.EXTENDS, true, ctx.filePath, startLine));
                    } else {
                        ctx.edges.add(new RelationEdge(id, baseName, EdgeKind.EXTENDS, false, ctx.filePath, startLine));
                    }
                }
            }
        }

        // 递归处理类体
        TSNode body = node.getChildByFieldName("body");
        if (body != null && !body.isNull()) {
            walkChildren(body, qualName, id, ctx);
        }
    }

    // ── 函数 / 方法 ───────────────────────────────────────────────────────────

    private void handleFunction(TSNode node, String enclosingClass, String enclosingId, ParseContext ctx) {
        handleFunction(node, enclosingClass, enclosingId, List.of(), ctx);
    }

    private void handleFunction(TSNode node, String enclosingClass, String enclosingId,
                                List<String> extraAnnotations, ParseContext ctx) {
        TSNode nameNode = node.getChildByFieldName("name");
        if (nameNode == null || nameNode.isNull()) return;
        String simpleName = nodeText(nameNode, ctx);
        if (simpleName.isEmpty()) return;

        boolean isAsync = "async_function_definition".equals(node.getType())
            || hasKeywordChild(node, "async");

        // qualifiedName：类名#方法名，或顶层函数名
        String qualName = enclosingClass != null
            ? enclosingClass + "#" + simpleName
            : simpleName;

        int startLine = node.getStartPoint().getRow() + 1;
        int endLine = node.getEndPoint().getRow() + 1;

        List<String> ownDecorators = extractDecorators(node, ctx);
        List<String> allAnnotations = new ArrayList<>(extraAnnotations);
        allAnnotations.addAll(ownDecorators);

        String paramTypes = extractParamTypes(node, ctx);
        String returnType = extractReturnType(node, ctx);

        Map<String, String> meta = new HashMap<>();
        meta.put("visibility", "public");
        if (!paramTypes.isEmpty()) meta.put("param_types", paramTypes);
        if (!returnType.isEmpty()) meta.put("return_type", returnType);
        if (isAsync) meta.put("is_async", "true");
        markIsTest(allAnnotations, simpleName, ctx, meta);

        String signature = (isAsync ? "async def " : "def ") + simpleName + "(" + paramTypes + ")"
            + (returnType.isEmpty() ? "" : " -> " + returnType);

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.METHOD, qualName);
        CodeUnit unit = new CodeUnit(
            id, CodeUnitKind.METHOD, "python",
            qualName, simpleName,
            ctx.filePath, startLine, endLine,
            nodeText(node, ctx), signature,
            List.copyOf(allAnnotations), enclosingClass, meta
        );
        ctx.units.add(unit);
        ctx.localMethodIdByQn.put(qualName, id);

        if (enclosingId != null) {
            ctx.edges.add(new RelationEdge(
                enclosingId, id, EdgeKind.CONTAINS, true, ctx.filePath, startLine
            ));
        }

        // 从函数体收集 CALLS 边
        TSNode body = node.getChildByFieldName("body");
        if (body != null && !body.isNull()) {
            collectCalls(body, id, enclosingClass, ctx);
        }
    }

    // ── 带装饰器的定义 ────────────────────────────────────────────────────────

    private void handleDecoratedDefinition(TSNode node, String enclosingClass, String enclosingId,
                                           ParseContext ctx) {
        List<String> decorators = new ArrayList<>();
        TSNode def = null;
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (child.isNull()) continue;
            switch (child.getType()) {
                case "decorator" -> decorators.add("@" + decoratorName(child, ctx));
                case "class_definition" -> {
                    def = child;
                }
                case "function_definition", "async_function_definition" -> {
                    def = child;
                }
                default -> { /* skip */ }
            }
        }
        if (def == null) return;

        if ("class_definition".equals(def.getType())) {
            handleClass(def, enclosingClass, ctx);
        } else {
            handleFunction(def, enclosingClass, enclosingId, decorators, ctx);
        }
    }

    private String decoratorName(TSNode decoratorNode, ParseContext ctx) {
        // decorator 节点：由 "@" 后跟名称/属性/调用组成
        for (int i = 0; i < decoratorNode.getChildCount(); i++) {
            TSNode child = decoratorNode.getChild(i);
            if (child.isNull() || "@".equals(child.getType())) continue;
            return nodeText(child, ctx).split("\\(")[0]; // 去掉调用参数
        }
        return "";
    }

    // ── 装饰器提取 ────────────────────────────────────────────────────────────

    private List<String> extractDecorators(TSNode node, ParseContext ctx) {
        List<String> decorators = new ArrayList<>();
        // 装饰器是类/函数节点的前驱兄弟节点，由 decorated_definition 处理
        // 但某些 AST 将装饰器内联为子字段，需检查
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (!child.isNull() && "decorator".equals(child.getType())) {
                decorators.add("@" + decoratorName(child, ctx));
            }
        }
        return decorators;
    }

    // ── IMPORTS 边 ───────────────────────────────────────────────────────────

    /**
     * {@code import foo}, {@code import foo.bar}, {@code import foo as f}
     * 产出每个顶层模块名的 IMPORTS 边。
     */
    private void handleImportStatement(TSNode node, ParseContext ctx) {
        int sourceLine = node.getStartPoint().getRow() + 1;
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (child.isNull()) continue;
            String ct = child.getType();
            if ("dotted_name".equals(ct)) {
                emitImportEdge(nodeText(child, ctx), sourceLine, ctx);
            } else if ("aliased_import".equals(ct)) {
                // aliased_import：dotted_name 'as' identifier，取第一个子节点
                for (int j = 0; j < child.getChildCount(); j++) {
                    TSNode gc = child.getChild(j);
                    if (!gc.isNull() && "dotted_name".equals(gc.getType())) {
                        emitImportEdge(nodeText(gc, ctx), sourceLine, ctx);
                        break;
                    }
                }
            }
        }
    }

    /**
     * {@code from foo import bar}, {@code from foo.bar import *}, {@code from . import baz}
     * 产出模块路径的 IMPORTS 边（忽略相对导入无法解析的情况）。
     */
    private void handleImportFromStatement(TSNode node, ParseContext ctx) {
        int sourceLine = node.getStartPoint().getRow() + 1;
        // module_name 字段或首个 dotted_name / relative_import 子节点
        TSNode moduleNode = node.getChildByFieldName("module_name");
        if (moduleNode != null && !moduleNode.isNull()) {
            String mt = moduleNode.getType();
            if ("dotted_name".equals(mt) || "relative_import".equals(mt)) {
                String moduleName = nodeText(moduleNode, ctx).replaceAll("^\\.*", ""); // 去掉前导点号
                if (!moduleName.isEmpty()) emitImportEdge(moduleName, sourceLine, ctx);
            }
            return;
        }
        // 兜底：查找首个 dotted_name 子节点
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (!child.isNull() && "dotted_name".equals(child.getType())) {
                emitImportEdge(nodeText(child, ctx), sourceLine, ctx);
                return;
            }
        }
    }

    private void emitImportEdge(String moduleName, int sourceLine, ParseContext ctx) {
        if (moduleName == null || moduleName.isBlank()) return;
        if (ctx.projectRoot != null) {
            // 尝试将模块解析为项目内的 .py 文件
            String relPath = moduleName.replace('.', '/') + ".py";
            Path candidate = ctx.projectRoot.resolve(relPath);
            if (Files.exists(candidate)) {
                String targetRel = PathUtil.toRelativePath(ctx.projectRoot, candidate);
                ctx.edges.add(new RelationEdge(ctx.filePath, targetRel,
                        EdgeKind.IMPORTS, true, ctx.filePath, sourceLine));
                return;
            }
            // 同时尝试包的 __init__.py
            Path initCandidate = ctx.projectRoot.resolve(moduleName.replace('.', '/') + "/__init__.py");
            if (java.nio.file.Files.exists(initCandidate)) {
                String targetRel = PathUtil.toRelativePath(ctx.projectRoot, initCandidate);
                ctx.edges.add(new RelationEdge(ctx.filePath, targetRel,
                        EdgeKind.IMPORTS, true, ctx.filePath, sourceLine));
                return;
            }
        }
        // 无法解析：以模块点分名作为 targetId 存储
        ctx.edges.add(new RelationEdge(ctx.filePath, moduleName,
                EdgeKind.IMPORTS, false, ctx.filePath, sourceLine));
    }

    // ── CALLS 边 ─────────────────────────────────────────────────────────────

    /**
     * 递归扫描函数体，为每个 {@code call} 节点产出 CALLS 边。
     * 跳过嵌套的函数/类定义（它们有各自的 callerId）。
     */
    private void collectCalls(TSNode node, String callerId, String enclosingClass, ParseContext ctx) {
        if (node.isNull()) return;
        if ("call".equals(node.getType())) {
            handleCallNode(node, callerId, enclosingClass, ctx);
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (child.isNull()) continue;
            // 不递归进入嵌套的函数/类体 — 它们有自己的 callerIds
            String ct = child.getType();
            if ("function_definition".equals(ct) || "async_function_definition".equals(ct)
                    || "class_definition".equals(ct) || "decorated_definition".equals(ct)) continue;
            collectCalls(child, callerId, enclosingClass, ctx);
        }
    }

    private void handleCallNode(TSNode callNode, String callerId, String enclosingClass, ParseContext ctx) {
        TSNode funcField = callNode.getChildByFieldName("function");
        if (funcField == null || funcField.isNull()) return;
        int sourceLine = callNode.getStartPoint().getRow() + 1;

        switch (funcField.getType()) {
            case "identifier" -> {
                // 简单调用：foo()
                String name = nodeText(funcField, ctx);
                // 1. 尝试顶层函数
                String targetId = ctx.localMethodIdByQn.get(name);
                if (targetId == null && enclosingClass != null) {
                    // 2. 尝试同类方法（如类体内的 helper()）
                    targetId = ctx.localMethodIdByQn.get(enclosingClass + "#" + name);
                }
                if (targetId != null) {
                    ctx.edges.add(new RelationEdge(callerId, targetId, EdgeKind.CALLS, true, ctx.filePath, sourceLine));
                } else {
                    // 未解析的外部调用占位 ID；projectId / filePath 为空
                    String bareId = CodeUnitIdUtil.computeId("", "", CodeUnitKind.METHOD, name);
                    ctx.edges.add(new RelationEdge(callerId, bareId, EdgeKind.CALLS, false, ctx.filePath, sourceLine));
                }
            }
            case "attribute" -> {
                // obj.method() — 仅在接收者为 self/cls 时解析
                TSNode objNode = funcField.getChildByFieldName("object");
                TSNode attrNode = funcField.getChildByFieldName("attribute");
                if (objNode == null || objNode.isNull() || attrNode == null || attrNode.isNull()) return;

                String obj = nodeText(objNode, ctx);
                String methodName = nodeText(attrNode, ctx);

                if (("self".equals(obj) || "cls".equals(obj)) && enclosingClass != null) {
                    String selfQn = enclosingClass + "#" + methodName;
                    String targetId = ctx.localMethodIdByQn.get(selfQn);
                    if (targetId != null) {
                        ctx.edges.add(new RelationEdge(callerId, targetId, EdgeKind.CALLS, true, ctx.filePath, sourceLine));
                    } else {
                        // 前向引用：计算确定性哈希以正确链接图
                        String fwdId = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.METHOD, selfQn);
                        ctx.edges.add(new RelationEdge(callerId, fwdId, EdgeKind.CALLS, false, ctx.filePath, sourceLine));
                    }
                }
                // 对任意 obj.method()，缺乏类型信息 — 跳过以减少噪声
            }
            default -> { /* 忽略其他调用形式（super()、lambda 等） */ }
        }
    }

    // ── 参数提取 ──────────────────────────────────────────────────────────────

    private String extractParamTypes(TSNode funcNode, ParseContext ctx) {
        TSNode params = funcNode.getChildByFieldName("parameters");
        if (params == null || params.isNull()) return "";

        List<String> types = new ArrayList<>();
        for (int i = 0; i < params.getChildCount(); i++) {
            TSNode param = params.getChild(i);
            if (param.isNull()) continue;
            switch (param.getType()) {
                case "identifier" -> types.add(nodeText(param, ctx));
                case "typed_parameter" -> {
                    TSNode typeNode = param.getChildByFieldName("type");
                    if (typeNode != null && !typeNode.isNull()) {
                        types.add(nodeText(typeNode, ctx));
                    } else {
                        TSNode nameNode = param.getChildByFieldName("name");
                        if (nameNode != null && !nameNode.isNull()) {
                            types.add(nodeText(nameNode, ctx));
                        }
                    }
                }
                case "default_parameter" -> {
                    TSNode nameNode = param.getChildByFieldName("name");
                    if (nameNode != null && !nameNode.isNull()) types.add(nodeText(nameNode, ctx));
                }
                case "typed_default_parameter" -> {
                    TSNode typeNode = param.getChildByFieldName("type");
                    if (typeNode != null && !typeNode.isNull()) {
                        types.add(nodeText(typeNode, ctx));
                    }
                }
                case "list_splat_pattern", "dictionary_splat_pattern" ->
                    types.add(nodeText(param, ctx));
                default -> { /* 标点等非参数节点 */ }
            }
        }
        // Remove self/cls — they don't contribute to semantic type info
        types.removeIf(t -> "self".equals(t) || "cls".equals(t));
        return String.join(",", types);
    }

    private String extractReturnType(TSNode funcNode, ParseContext ctx) {
        TSNode retType = funcNode.getChildByFieldName("return_type");
        if (retType == null || retType.isNull()) return "";
        // return_type 节点文本为 "-> Type"，去掉 "->"
        String text = nodeText(retType, ctx).trim();
        if (text.startsWith("->")) text = text.substring(2).trim();
        return text;
    }

    // ── 测试方法检测 ──────────────────────────────────────────────────────────

    private void markIsTest(List<String> annotations, String simpleName, ParseContext ctx,
                            Map<String, String> meta) {
        boolean isTest = simpleName.startsWith("test_") || simpleName.startsWith("Test");
        if (!isTest) {
            for (String ann : annotations) {
                if (ann.contains("pytest") || ann.contains("test") || ann.contains("Test")) {
                    isTest = true;
                    break;
                }
            }
        }
        if (!isTest && ctx.filePath != null) {
            String fileName = Path.of(ctx.filePath).getFileName().toString();
            isTest = fileName.startsWith("test_") || fileName.endsWith("_test.py");
        }
        if (isTest) meta.put("is_test", "true");
    }

    // ── 关键字子节点检测 ──────────────────────────────────────────────────────

    private boolean hasKeywordChild(TSNode node, String keyword) {
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (!child.isNull() && keyword.equals(child.getType())) return true;
        }
        return false;
    }

    // ── 文本辅助方法 ──────────────────────────────────────────────────────────

    private String nodeText(TSNode node, ParseContext ctx) {
        int start = node.getStartByte();
        int end = node.getEndByte();
        if (start < 0 || end > ctx.sourceBytes.length || start >= end) return "";
        return new String(ctx.sourceBytes, start, end - start, StandardCharsets.UTF_8);
    }

    private String resolveFilePath(Path file, ParseOptions options) {
        if (options != null && options.projectRoot() != null) {
            return PathUtil.toRelativePath(options.projectRoot(), file);
        }
        return file.toString().replace('\\', '/');
    }

    // ── 解析上下文 ────────────────────────────────────────────────────────────

    private static final class ParseContext {
        final String filePath;
        final String projectId;
        final byte[] sourceBytes;
        final Path projectRoot;
        final List<CodeUnit> units = new ArrayList<>();
        final List<RelationEdge> edges = new ArrayList<>();
        /** 文件内类的 qualName / simpleName → ID 映射（用于解析 EXTENDS 关系）。 */
        final Map<String, String> localClassIdByQn = new HashMap<>();
        /** 文件内方法/函数的 qualName → ID 映射（用于解析 CALLS 关系）。 */
        final Map<String, String> localMethodIdByQn = new HashMap<>();

        ParseContext(String filePath, String projectId, byte[] sourceBytes, Path projectRoot) {
            this.filePath = filePath;
            this.projectId = projectId;
            this.sourceBytes = sourceBytes;
            this.projectRoot = projectRoot;
        }
    }
}
