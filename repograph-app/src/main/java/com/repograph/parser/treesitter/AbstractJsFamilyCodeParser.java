package com.repograph.parser.treesitter;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.model.RelationEdge;
import com.repograph.core.parser.CodeParser;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import com.repograph.core.util.CodeUnitIdUtil;
import com.repograph.core.util.PathUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.treesitter.TSNode;
import org.treesitter.TSParser;
import org.treesitter.TSTree;
import org.treesitter.TSLanguage;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Tree-sitter JavaScript/TypeScript 语法族解析器的共享实现。
 *
 * <p>tree-sitter-javascript 与 tree-sitter-typescript 的节点类型是超集关系
 * （function_declaration / class_declaration / method_definition / call_expression 等），
 * 因此遍历逻辑共享于此，子类只提供语言标识符与语法实例。
 *
 * <p>映射：function_declaration / generator_function_declaration / 变量声明的
 * arrow_function 与 function 值 → FUNCTION，method_definition → METHOD，
 * class_declaration（含 abstract）→ CLASS，interface_declaration → INTERFACE，
 * enum_declaration → ENUM，type_alias_declaration → TYPEDEF，
 * class 体内 field_definition → FIELD（best-effort）。CALLS 边收集与 C 解析器同策略：
 * 剥离成员访问前缀，内置符号不建边，未解析调用使用占位 ID（resolvable=false）。
 *
 * <p>若 native 库加载失败，记录 ERROR 日志并返回空结果，不抛出异常。
 *
 * @author leolu
 * @since 0.6.0
 */
abstract class AbstractJsFamilyCodeParser implements CodeParser {

    private static final Logger log = LoggerFactory.getLogger(AbstractJsFamilyCodeParser.class);

    /** JS/TS 内置符号与高频全局函数，命中时不建 CALLS 边。 */
    private static final Set<String> BUILTIN_SYMBOLS = Set.of(
        "require", "console", "JSON", "Math", "Object", "Array", "Promise",
        "process", "Buffer", "Map", "Set", "Date", "Reflect", "Symbol",
        "setTimeout", "setInterval", "clearTimeout", "clearInterval",
        "fetch", "parseInt", "parseFloat", "isNaN", "encodeURIComponent",
        "decodeURIComponent", "structuredClone", "queueMicrotask"
    );

    /** 入口点精确匹配名称。 */
    private static final Set<String> ENTRY_EXACT = Set.of("main");

    /** 入口点前缀列表（JS/TS 驼峰约定，如 handleLogin、initApp）。 */
    private static final String[] ENTRY_PREFIXES = {"handle", "init", "start", "run", "serve"};

    /** 入口点后缀列表。 */
    private static final String[] ENTRY_SUFFIXES = {"Handler", "Callback", "Listener"};

    private final String languageId;
    private final boolean nativeAvailable;

    AbstractJsFamilyCodeParser(String languageId) {
        this.languageId = languageId;
        this.nativeAvailable = probeNative();
    }

    /** 子类提供语法实例；.tsx 等按扩展名切换语法的场景在实现内自行判断。 */
    protected abstract TSLanguage grammarFor(Path file);

    private boolean probeNative() {
        try {
            grammarFor(null);
            return true;
        } catch (Throwable t) {
            log.error("Tree-sitter {} native library failed to load — {} parsing disabled. Cause: {}",
                    languageId, languageId, t.getMessage());
            return false;
        }
    }

    @Override
    public boolean supports(String language) {
        return nativeAvailable && languageId.equalsIgnoreCase(language);
    }

    @Override
    public ParseResult parse(Path file, ParseOptions options) {
        if (!nativeAvailable) return ParseResult.empty();

        String source;
        try {
            source = Files.readString(file);
        } catch (IOException e) {
            log.warn("Failed to read {} file '{}': {}", languageId, file, e.getMessage());
            return ParseResult.empty();
        }

        String filePath = resolveFilePath(file, options);
        byte[] sourceBytes = source.getBytes(StandardCharsets.UTF_8);

        TSParser parser = new TSParser();
        try {
            parser.setLanguage(grammarFor(file));
        } catch (Throwable t) {
            log.error("Failed to set Tree-sitter {} language: {}", languageId, t.getMessage());
            return ParseResult.empty();
        }

        TSTree tree = parser.parseString(null, source);
        if (tree == null) {
            log.warn("Tree-sitter returned null tree for '{}'", file);
            return ParseResult.empty();
        }

        ParseContext ctx = new ParseContext(filePath, sourceBytes, options);
        walk(tree.getRootNode(), ctx, null);

        return ParseResult.of(List.copyOf(ctx.units), List.copyOf(ctx.edges),
                getClass().getSimpleName());
    }

    // ── 遍历 ─────────────────────────────────────────────────────────────────

    private void walk(TSNode node, ParseContext ctx, String currentClass) {
        switch (node.getType()) {
            case "export_statement" -> {
                // export function foo() {} — 深入包装节点继续识别
                for (int i = 0; i < node.getNamedChildCount(); i++) {
                    TSNode child = node.getNamedChild(i);
                    if (!child.isNull()) walk(child, ctx, currentClass);
                }
            }
            case "function_declaration", "generator_function_declaration" ->
                    handleFunction(node, ctx, currentClass, "function");
            case "class_declaration", "abstract_class_declaration" ->
                    handleClass(node, ctx, node.getType().startsWith("abstract"));
            case "interface_declaration" -> handleNamedDecl(node, ctx, CodeUnitKind.INTERFACE, "interface");
            case "enum_declaration" -> handleNamedDecl(node, ctx, CodeUnitKind.ENUM, "enum");
            case "type_alias_declaration" -> handleNamedDecl(node, ctx, CodeUnitKind.TYPEDEF, "type");
            case "lexical_declaration", "variable_declaration" ->
                    handleVariableDeclaration(node, ctx, currentClass);
            case "method_definition" -> handleMethod(node, ctx, currentClass);
            case "abstract_method_signature" -> handleMethod(node, ctx, currentClass);
            default -> {
                for (int i = 0; i < node.getNamedChildCount(); i++) {
                    TSNode child = node.getNamedChild(i);
                    if (!child.isNull()) walk(child, ctx, currentClass);
                }
            }
        }
    }

    // ── 函数 / 方法 ───────────────────────────────────────────────────────────

    private void handleFunction(TSNode node, ParseContext ctx, String currentClass, String keyword) {
        TSNode nameNode = node.getChildByFieldName("name");
        if (nameNode == null || nameNode.isNull()) return;
        String name = nodeText(nameNode, ctx);
        emitFunctionLike(node, node.getChildByFieldName("body"), ctx, currentClass, name,
                node.getChildByFieldName("parameters"), keyword + " " + name);
    }

    private void handleMethod(TSNode node, ParseContext ctx, String currentClass) {
        TSNode nameNode = node.getChildByFieldName("name");
        if (nameNode == null || nameNode.isNull()) {
            // abstract_method_signature 的方法名是无 name 字段的 property_identifier 子节点
            for (int i = 0; i < node.getNamedChildCount(); i++) {
                TSNode child = node.getNamedChild(i);
                if (!child.isNull() && "property_identifier".equals(child.getType())) {
                    nameNode = child;
                    break;
                }
            }
        }
        if (nameNode == null || nameNode.isNull()) return;
        String name = nodeText(nameNode, ctx);
        String qn = currentClass != null ? currentClass + "." + name : name;
        emitFunctionLike(node, node.getChildByFieldName("body"), ctx, currentClass, qn,
                node.getChildByFieldName("parameters"), name);
    }

    private void handleVariableDeclaration(TSNode node, ParseContext ctx, String currentClass) {
        for (int i = 0; i < node.getNamedChildCount(); i++) {
            TSNode declarator = node.getNamedChild(i);
            if (declarator.isNull() || !"variable_declarator".equals(declarator.getType())) continue;
            TSNode nameNode = declarator.getChildByFieldName("name");
            TSNode valueNode = declarator.getChildByFieldName("value");
            if (nameNode == null || nameNode.isNull() || valueNode == null || valueNode.isNull()) continue;
            String valueType = valueNode.getType();
            if (!"arrow_function".equals(valueType) && !"function".equals(valueType)
                    && !"function_expression".equals(valueType)) {
                continue;
            }
            String name = nodeText(nameNode, ctx);
            emitFunctionLike(declarator, valueNode.getChildByFieldName("body"), ctx, currentClass,
                    name, valueNode.getChildByFieldName("parameters"), name);
        }
    }

    private void emitFunctionLike(TSNode node, TSNode bodyNode, ParseContext ctx, String currentClass,
                                  String qualifiedName, TSNode parameters, String signatureLabel) {
        if (qualifiedName == null || qualifiedName.isEmpty()) return;
        String simpleName = qualifiedName.substring(qualifiedName.lastIndexOf('.') + 1);
        String params = parameters != null && !parameters.isNull()
                ? nodeText(parameters, ctx) : "";
        int startLine = node.getStartPoint().getRow() + 1;
        int endLine = node.getEndPoint().getRow() + 1;

        CodeUnitKind kind = currentClass != null ? CodeUnitKind.METHOD : CodeUnitKind.FUNCTION;
        Map<String, String> meta = new HashMap<>();
        meta.put("param_types", params);
        meta.put("visibility", "public");
        if (currentClass != null) meta.put("owner", currentClass);
        if (isEntryPoint(simpleName)) meta.put("is_entry_point", "true");

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, kind, qualifiedName);
        CodeUnit unit = new CodeUnit(
            id, kind, languageId,
            qualifiedName, simpleName,
            ctx.filePath, startLine, endLine,
            nodeText(node, ctx),
            signatureLabel + params,
            List.of(), currentClass, meta
        );
        ctx.units.add(unit);
        ctx.functionIdByName.put(simpleName, id);

        if (bodyNode != null && !bodyNode.isNull()) {
            collectCalls(bodyNode, unit, ctx);
        }
    }

    // ── 类 / 接口 / 枚举 / 类型别名 ───────────────────────────────────────────

    private void handleClass(TSNode node, ParseContext ctx, boolean isAbstract) {
        TSNode nameNode = node.getChildByFieldName("name");
        if (nameNode == null || nameNode.isNull()) return;
        String name = nodeText(nameNode, ctx);
        if (name.isEmpty()) return;

        int startLine = node.getStartPoint().getRow() + 1;
        int endLine = node.getEndPoint().getRow() + 1;

        Map<String, String> meta = new HashMap<>();
        meta.put("visibility", "public");
        if (isAbstract) meta.put("is_abstract", "true");

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.CLASS, name);
        ctx.units.add(new CodeUnit(
            id, CodeUnitKind.CLASS, languageId,
            name, name,
            ctx.filePath, startLine, endLine,
            nodeText(node, ctx),
            (isAbstract ? "abstract class " : "class ") + name,
            List.of(), null, meta
        ));

        TSNode body = node.getChildByFieldName("body");
        if (body != null && !body.isNull()) {
            for (int i = 0; i < body.getNamedChildCount(); i++) {
                TSNode member = body.getNamedChild(i);
                if (member.isNull()) continue;
                switch (member.getType()) {
                    case "method_definition", "abstract_method_signature" ->
                            handleMethod(member, ctx, name);
                    case "field_definition", "public_field_definition" ->
                            handleField(member, ctx, name);
                    default -> { /* skip */ }
                }
            }
        }
    }

    private void handleField(TSNode node, ParseContext ctx, String className) {
        TSNode nameNode = node.getChildByFieldName("name");
        if (nameNode == null || nameNode.isNull()) return;
        String fieldName = nodeText(nameNode, ctx);
        String qn = className + "." + fieldName;
        int sl = node.getStartPoint().getRow() + 1;
        int el = node.getEndPoint().getRow() + 1;

        Map<String, String> meta = new HashMap<>();
        meta.put("visibility", "public");

        String fieldId = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.FIELD, qn);
        ctx.units.add(new CodeUnit(
            fieldId, CodeUnitKind.FIELD, languageId,
            qn, fieldName,
            ctx.filePath, sl, el,
            nodeText(node, ctx), fieldName,
            List.of(), className, meta
        ));
    }

    private void handleNamedDecl(TSNode node, ParseContext ctx, CodeUnitKind kind, String keyword) {
        TSNode nameNode = node.getChildByFieldName("name");
        if (nameNode == null || nameNode.isNull()) return;
        String name = nodeText(nameNode, ctx);
        if (name.isEmpty()) return;

        int startLine = node.getStartPoint().getRow() + 1;
        int endLine = node.getEndPoint().getRow() + 1;

        Map<String, String> meta = new HashMap<>();
        meta.put("visibility", "public");

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, kind, name);
        ctx.units.add(new CodeUnit(
            id, kind, languageId,
            name, name,
            ctx.filePath, startLine, endLine,
            nodeText(node, ctx), keyword + " " + name,
            List.of(), null, meta
        ));
    }

    // ── CALLS 边 ─────────────────────────────────────────────────────────────

    private void collectCalls(TSNode node, CodeUnit caller, ParseContext ctx) {
        if (node.isNull()) return;
        if ("call_expression".equals(node.getType())) {
            TSNode funcNode = node.getChildByFieldName("function");
            if (funcNode != null && !funcNode.isNull()) {
                String callee = nodeText(funcNode, ctx).trim();
                // 接收者根名是内置符号时整条跳过（console.log / JSON.stringify 等）
                String receiverRoot = callee.split("\\?\\.|\\.")[0];
                if (BUILTIN_SYMBOLS.contains(receiverRoot)) {
                    return;
                }
                // 剥离成员访问前缀（obj.method / obj?.method）
                int optionalPos = callee.lastIndexOf("?.");
                int dotPos = callee.lastIndexOf('.');
                if (optionalPos >= 0 && optionalPos >= dotPos) callee = callee.substring(optionalPos + 2);
                else if (dotPos >= 0) callee = callee.substring(dotPos + 1);

                if (!callee.isEmpty() && !BUILTIN_SYMBOLS.contains(callee)) {
                    int sourceLine = node.getStartPoint().getRow() + 1;
                    String targetId = ctx.functionIdByName.get(callee);
                    if (targetId != null) {
                        ctx.edges.add(new RelationEdge(
                            caller.id(), targetId, EdgeKind.CALLS, true, ctx.filePath, sourceLine
                        ));
                    } else {
                        // 未解析的外部调用占位 ID；projectId / filePath 为空，
                        // 不会与真实 CodeUnit ID 冲突
                        String bareId = CodeUnitIdUtil.computeId("", "", CodeUnitKind.FUNCTION, callee);
                        ctx.edges.add(new RelationEdge(
                            caller.id(), bareId, EdgeKind.CALLS, false, ctx.filePath, sourceLine
                        ));
                    }
                }
            }
        }
        for (int i = 0; i < node.getNamedChildCount(); i++) {
            TSNode child = node.getNamedChild(i);
            if (!child.isNull()) collectCalls(child, caller, ctx);
        }
    }

    // ── 入口点检测 ────────────────────────────────────────────────────────────

    private boolean isEntryPoint(String name) {
        if (ENTRY_EXACT.contains(name)) return true;
        for (String prefix : ENTRY_PREFIXES) {
            if (name.startsWith(prefix)) return true;
        }
        for (String suffix : ENTRY_SUFFIXES) {
            if (name.endsWith(suffix)) return true;
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
        final ParseOptions options;
        final List<CodeUnit> units = new ArrayList<>();
        final List<RelationEdge> edges = new ArrayList<>();
        /** 文件内函数/方法简单名 → ID 映射，用于解析文件内的 CALLS 边。 */
        final Map<String, String> functionIdByName = new HashMap<>();

        ParseContext(String filePath, byte[] sourceBytes, ParseOptions options) {
            this.filePath = filePath;
            this.projectId = options != null && options.projectId() != null ? options.projectId() : "";
            this.sourceBytes = sourceBytes;
            this.options = options;
        }
    }
}
