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
import org.springframework.stereotype.Component;
import org.treesitter.TSNode;
import org.treesitter.TSParser;
import org.treesitter.TSTree;
import org.treesitter.TreeSitterC;

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
 * 基于 Tree-sitter 的 C 语言精确解析器，产出 CodeUnit 列表和 RelationEdge 列表。
 *
 * <p>支持的节点类型：function_definition → FUNCTION，struct_specifier → STRUCT，
 * union_specifier → UNION，enum_specifier → ENUM，type_definition → TYPEDEF，
 * preproc_def / preproc_function_def → MACRO。
 *
 * <p>函数名通过递归解包 declarator 节点获取，正确处理指针返回函数（{@code char *foo()}）。
 * 若 native 库加载失败，记录 ERROR 日志并返回空结果，不抛出异常。
 *
 * @author leolu
 * @since 0.1.0
 */
@Component
public class CCodeParser implements CodeParser {

    private static final Logger log = LoggerFactory.getLogger(CCodeParser.class);

    /** C 内置/libc/Linux 内核符号集合，命中时不建 CALLS 边。 */
    private static final Set<String> BUILTIN_SYMBOLS = Set.of(
        "printf", "fprintf", "sprintf", "snprintf", "scanf", "sscanf",
        "malloc", "calloc", "realloc", "free",
        "memcpy", "memmove", "memset", "memcmp", "strlen", "strcpy", "strncpy",
        "strcmp", "strncmp", "strcat", "strncat", "strchr", "strrchr",
        "fopen", "fclose", "fread", "fwrite", "fgets", "fputs",
        "exit", "abort", "assert",
        "BUG_ON", "WARN_ON", "kmalloc", "kfree", "kzalloc",
        "container_of", "ARRAY_SIZE", "printk",
        "spin_lock", "spin_unlock", "mutex_lock", "mutex_unlock"
    );

    /** 入口点精确匹配名称。 */
    private static final Set<String> ENTRY_EXACT = Set.of("main");

    /** 入口点前缀列表。 */
    private static final String[] ENTRY_PREFIXES = {
        "init_", "start_", "run_", "cmd_", "server_", "client_", "handle_"
    };

    /** 入口点后缀列表。 */
    private static final String[] ENTRY_SUFFIXES = {
        "_init", "_start", "_run", "_open", "_close", "_handler", "_callback"
    };

    private static final boolean NATIVE_AVAILABLE;

    static {
        boolean available = false;
        try {
            new TreeSitterC();
            available = true;
        } catch (Throwable t) {
            log.error("Tree-sitter C native library failed to load — C parsing disabled. " +
                      "Cause: {}. All .c/.h files will be skipped.", t.getMessage());
        }
        NATIVE_AVAILABLE = available;
    }

    @Override
    public boolean supports(String language) {
        return NATIVE_AVAILABLE && "c".equalsIgnoreCase(language);
    }

    @Override
    public ParseResult parse(Path file, ParseOptions options) {
        if (!NATIVE_AVAILABLE) return ParseResult.empty();

        String source;
        try {
            source = Files.readString(file);
        } catch (IOException e) {
            log.warn("Failed to read C file '{}': {}", file, e.getMessage());
            return ParseResult.empty();
        }

        String filePath = resolveFilePath(file, options);
        byte[] sourceBytes = source.getBytes(StandardCharsets.UTF_8);

        TSParser parser = new TSParser();
        try {
            parser.setLanguage(new TreeSitterC());
        } catch (Throwable t) {
            log.error("Failed to set Tree-sitter C language: {}", t.getMessage());
            return ParseResult.empty();
        }

        TSTree tree = parser.parseString(null, source);
        if (tree == null) {
            log.warn("Tree-sitter returned null tree for '{}'", file);
            return ParseResult.empty();
        }

        TSNode root = tree.getRootNode();
        ParseContext ctx = new ParseContext(filePath, sourceBytes, options);
        walkRoot(root, ctx);

        return ParseResult.of(List.copyOf(ctx.units), List.copyOf(ctx.edges), "CCodeParser");
    }

    // ── 根节点遍历 ───────────────────────────────────────────────────────────

    private void walkRoot(TSNode root, ParseContext ctx) {
        int count = root.getChildCount();
        for (int i = 0; i < count; i++) {
            TSNode child = root.getChild(i);
            if (child.isNull()) continue;
            processTopLevelNode(child, ctx);
        }
    }

    private void processTopLevelNode(TSNode node, ParseContext ctx) {
        switch (node.getType()) {
            case "function_definition" -> handleFunctionDefinition(node, ctx);
            case "declaration"          -> handleDeclaration(node, ctx);
            case "struct_specifier"     -> handleStructOrUnion(node, ctx, CodeUnitKind.STRUCT);
            case "union_specifier"      -> handleStructOrUnion(node, ctx, CodeUnitKind.UNION);
            case "enum_specifier"       -> handleEnumSpecifier(node, ctx);
            case "type_definition"      -> handleTypeDefinition(node, ctx);
            case "preproc_def"          -> handlePreprocDef(node, ctx);
            case "preproc_function_def" -> handlePreprocFunctionDef(node, ctx);
            case "preproc_include"      -> handleInclude(node, ctx);
            default -> { /* skip */ }
        }
    }

    // ── 函数定义 ─────────────────────────────────────────────────────────────

    private void handleFunctionDefinition(TSNode node, ParseContext ctx) {
        TSNode declarator = node.getChildByFieldName("declarator");
        if (declarator == null || declarator.isNull()) return;

        String name = extractFunctionName(declarator, ctx);
        if (name == null || name.isEmpty()) return;

        TSNode typeNode = node.getChildByFieldName("type");
        String returnType = (typeNode != null && !typeNode.isNull()) ? nodeText(typeNode, ctx) : "";
        boolean isStatic = hasStorageClass(node, ctx, "static");

        String paramTypes = extractParamTypes(declarator, ctx);
        int startLine = node.getStartPoint().getRow() + 1;
        int endLine = node.getEndPoint().getRow() + 1;

        Map<String, String> meta = new HashMap<>();
        meta.put("return_type", returnType);
        meta.put("param_types", paramTypes);
        meta.put("visibility", isStatic ? "file-local" : "public");
        meta.put("is_static", String.valueOf(isStatic));
        if (isEntryPoint(name)) {
            meta.put("is_entry_point", "true");
        }

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.FUNCTION, name);
        CodeUnit unit = new CodeUnit(
            id, CodeUnitKind.FUNCTION, "c",
            name, name,
            ctx.filePath, startLine, endLine,
            nodeText(node, ctx),
            returnType + " " + name + "(" + paramTypes + ")",
            List.of(), null, meta
        );
        ctx.units.add(unit);
        ctx.functionIdByName.put(name, id);

        TSNode body = node.getChildByFieldName("body");
        if (body != null && !body.isNull()) {
            collectCalls(body, unit, ctx);
        }
    }

    // ── 函数声明（原型）─────────────────────────────────────────────────────

    private void handleDeclaration(TSNode node, ParseContext ctx) {
        // 检查 type 字段是否为 struct/union/enum 说明符（如 "struct Foo { ... };"）
        TSNode typeNode = node.getChildByFieldName("type");
        if (typeNode != null && !typeNode.isNull()) {
            switch (typeNode.getType()) {
                case "struct_specifier" -> { handleStructOrUnion(typeNode, ctx, CodeUnitKind.STRUCT); return; }
                case "union_specifier"  -> { handleStructOrUnion(typeNode, ctx, CodeUnitKind.UNION); return; }
                case "enum_specifier"   -> { handleEnumSpecifier(typeNode, ctx); return; }
                default -> { /* 继续检查函数原型 */ }
            }
        }

        // 扫描子节点，查找包装了 function_declarator 的声明符（函数原型）
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (child.isNull()) continue;
            if (hasFunctionDeclarator(child)) {
                handleFunctionPrototype(node, child, ctx);
                return;
            }
        }
    }

    private boolean hasFunctionDeclarator(TSNode node) {
        if (node.isNull()) return false;
        if ("function_declarator".equals(node.getType())) return true;
        if ("pointer_declarator".equals(node.getType()) ||
            "parenthesized_declarator".equals(node.getType())) {
            for (int i = 0; i < node.getChildCount(); i++) {
                TSNode child = node.getChild(i);
                if (!child.isNull() && hasFunctionDeclarator(child)) return true;
            }
        }
        return false;
    }

    private void handleFunctionPrototype(TSNode declNode, TSNode declarator, ParseContext ctx) {
        String name = extractFunctionName(declarator, ctx);
        if (name == null || name.isEmpty()) return;

        TSNode typeNode = declNode.getChildByFieldName("type");
        String returnType = (typeNode != null && !typeNode.isNull()) ? nodeText(typeNode, ctx) : "";
        boolean isStatic = hasStorageClass(declNode, ctx, "static");
        String paramTypes = extractParamTypes(declarator, ctx);
        int startLine = declNode.getStartPoint().getRow() + 1;
        int endLine = declNode.getEndPoint().getRow() + 1;

        Map<String, String> meta = new HashMap<>();
        meta.put("return_type", returnType);
        meta.put("param_types", paramTypes);
        meta.put("visibility", isStatic ? "file-local" : "public");
        meta.put("is_static", String.valueOf(isStatic));
        meta.put("is_declaration", "true");

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.FUNCTION, name + "#decl");
        ctx.units.add(new CodeUnit(
            id, CodeUnitKind.FUNCTION, "c",
            name, name,
            ctx.filePath, startLine, endLine,
            nodeText(declNode, ctx),
            returnType + " " + name + "(" + paramTypes + ")",
            List.of(), null, meta
        ));
    }

    // ── 结构体 / 联合体 ───────────────────────────────────────────────────────

    private void handleStructOrUnion(TSNode node, ParseContext ctx, CodeUnitKind kind) {
        TSNode nameNode = node.getChildByFieldName("name");
        if (nameNode == null || nameNode.isNull()) return;
        String name = nodeText(nameNode, ctx);
        if (name.isEmpty()) return;

        int startLine = node.getStartPoint().getRow() + 1;
        int endLine = node.getEndPoint().getRow() + 1;

        Map<String, String> meta = new HashMap<>();
        meta.put("visibility", "public");

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, kind, name);
        CodeUnit unit = new CodeUnit(
            id, kind, "c",
            name, name,
            ctx.filePath, startLine, endLine,
            nodeText(node, ctx),
            (kind == CodeUnitKind.STRUCT ? "struct " : "union ") + name,
            List.of(), null, meta
        );
        ctx.units.add(unit);

        TSNode body = node.getChildByFieldName("body");
        if (body != null && !body.isNull()) {
            extractStructFields(body, name, id, ctx);
        }
    }

    private void extractStructFields(TSNode body, String parentName, String parentId, ParseContext ctx) {
        for (int i = 0; i < body.getChildCount(); i++) {
            TSNode child = body.getChild(i);
            if (child.isNull() || !"field_declaration".equals(child.getType())) continue;

            TSNode typeNode = child.getChildByFieldName("type");
            String fieldType = (typeNode != null && !typeNode.isNull()) ? nodeText(typeNode, ctx) : "";

            // 使用 "declarator" 字段名查找字段名（处理 field_identifier 和 pointer_field_declarator）
            for (int j = 0; j < child.getChildCount(); j++) {
                String fieldNameForChild = child.getFieldNameForChild(j);
                if (!"declarator".equals(fieldNameForChild)) continue;
                TSNode part = child.getChild(j);
                if (part.isNull()) continue;

                // field_identifier 是直接字段名；指针/数组声明符会嵌套包装
                String fieldName = "field_identifier".equals(part.getType())
                    ? nodeText(part, ctx)
                    : extractSimpleName(part, ctx);
                if (fieldName.isEmpty()) continue;

                String qn = parentName + "." + fieldName;
                int sl = part.getStartPoint().getRow() + 1;
                int el = part.getEndPoint().getRow() + 1;

                Map<String, String> meta = new HashMap<>();
                meta.put("return_type", fieldType);
                meta.put("visibility", "public");

                String fieldId = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.FIELD, qn);
                ctx.units.add(new CodeUnit(
                    fieldId, CodeUnitKind.FIELD, "c",
                    qn, fieldName,
                    ctx.filePath, sl, el,
                    nodeText(child, ctx), fieldType + " " + fieldName,
                    List.of(), parentName, meta
                ));
                ctx.edges.add(new RelationEdge(
                    parentId, fieldId, EdgeKind.CONTAINS, true, ctx.filePath, sl
                ));
            }
        }
    }

    // ── 枚举 ─────────────────────────────────────────────────────────────────

    private void handleEnumSpecifier(TSNode node, ParseContext ctx) {
        TSNode nameNode = node.getChildByFieldName("name");
        if (nameNode == null || nameNode.isNull()) return;
        String name = nodeText(nameNode, ctx);
        if (name.isEmpty()) return;

        int startLine = node.getStartPoint().getRow() + 1;
        int endLine = node.getEndPoint().getRow() + 1;

        Map<String, String> meta = new HashMap<>();
        meta.put("visibility", "public");

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.ENUM, name);
        ctx.units.add(new CodeUnit(
            id, CodeUnitKind.ENUM, "c",
            name, name,
            ctx.filePath, startLine, endLine,
            nodeText(node, ctx), "enum " + name,
            List.of(), null, meta
        ));
    }

    // ── 类型定义（Typedef）────────────────────────────────────────────────────

    private void handleTypeDefinition(TSNode node, ParseContext ctx) {
        String alias = null;
        for (int i = node.getChildCount() - 1; i >= 0; i--) {
            TSNode child = node.getChild(i);
            if (child.isNull()) continue;
            String t = child.getType();
            if ("type_identifier".equals(t) || "identifier".equals(t)) {
                alias = nodeText(child, ctx);
                break;
            }
        }
        if (alias == null || alias.isEmpty()) return;

        int startLine = node.getStartPoint().getRow() + 1;
        int endLine = node.getEndPoint().getRow() + 1;

        Map<String, String> meta = new HashMap<>();
        meta.put("visibility", "public");

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.TYPEDEF, alias);
        ctx.units.add(new CodeUnit(
            id, CodeUnitKind.TYPEDEF, "c",
            alias, alias,
            ctx.filePath, startLine, endLine,
            nodeText(node, ctx), "typedef ... " + alias,
            List.of(), null, meta
        ));
    }

    // ── 宏定义 ───────────────────────────────────────────────────────────────

    private void handlePreprocDef(TSNode node, ParseContext ctx) {
        TSNode nameNode = node.getChildByFieldName("name");
        if (nameNode == null || nameNode.isNull()) return;
        String name = nodeText(nameNode, ctx);

        int startLine = node.getStartPoint().getRow() + 1;
        int endLine = node.getEndPoint().getRow() + 1;

        Map<String, String> meta = new HashMap<>();
        meta.put("visibility", "public");

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.MACRO, name);
        ctx.units.add(new CodeUnit(
            id, CodeUnitKind.MACRO, "c",
            name, name,
            ctx.filePath, startLine, endLine,
            nodeText(node, ctx), "#define " + name,
            List.of(), null, meta
        ));
    }

    private void handlePreprocFunctionDef(TSNode node, ParseContext ctx) {
        TSNode nameNode = node.getChildByFieldName("name");
        if (nameNode == null || nameNode.isNull()) return;
        String name = nodeText(nameNode, ctx);

        int startLine = node.getStartPoint().getRow() + 1;
        int endLine = node.getEndPoint().getRow() + 1;

        Map<String, String> meta = new HashMap<>();
        meta.put("visibility", "public");

        String id = CodeUnitIdUtil.computeId(ctx.projectId, ctx.filePath, CodeUnitKind.MACRO, name);
        ctx.units.add(new CodeUnit(
            id, CodeUnitKind.MACRO, "c",
            name, name,
            ctx.filePath, startLine, endLine,
            nodeText(node, ctx), "#define " + name + "(...)",
            List.of(), null, meta
        ));
    }

    // ── 头文件包含 ────────────────────────────────────────────────────────────

    private void handleInclude(TSNode node, ParseContext ctx) {
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (child.isNull()) continue;
            if ("string_literal".equals(child.getType())) {
                String raw = nodeText(child, ctx);
                String headerPath = raw.replaceAll("^\"|\"$", "");
                addImportEdge(headerPath, node, ctx);
                return;
            }
            if ("system_lib_string".equals(child.getType())) {
                return; // 按规范跳过系统头文件
            }
        }
    }

    private void addImportEdge(String headerPath, TSNode node, ParseContext ctx) {
        if (ctx.options == null || ctx.options.projectRoot() == null) return;

        Path projectRoot = ctx.options.projectRoot();
        Path resolved = projectRoot.resolve(headerPath).normalize();
        if (!Files.exists(resolved)) {
            Path fileDir = projectRoot.resolve(ctx.filePath).getParent();
            if (fileDir != null) {
                resolved = fileDir.resolve(headerPath).normalize();
            }
        }

        if (Files.exists(resolved)) {
            String targetRelPath = PathUtil.toRelativePath(projectRoot, resolved);
            int sourceLine = node.getStartPoint().getRow() + 1;
            ctx.edges.add(new RelationEdge(
                ctx.filePath, targetRelPath, EdgeKind.IMPORTS, true, ctx.filePath, sourceLine
            ));
        }
    }

    // ── CALLS 边 ─────────────────────────────────────────────────────────────

    private void collectCalls(TSNode node, CodeUnit caller, ParseContext ctx) {
        if (node.isNull()) return;
        if ("call_expression".equals(node.getType())) {
            TSNode funcNode = node.getChildByFieldName("function");
            if (funcNode != null && !funcNode.isNull()) {
                String callee = nodeText(funcNode, ctx).trim();
                // 去掉成员访问前缀（obj->method 或 obj.method）
                int arrowPos = callee.lastIndexOf("->");
                int dotPos = callee.lastIndexOf('.');
                if (arrowPos >= 0) callee = callee.substring(arrowPos + 2);
                else if (dotPos >= 0) callee = callee.substring(dotPos + 1);

                if (!callee.isEmpty() && !BUILTIN_SYMBOLS.contains(callee)) {
                    int sourceLine = node.getStartPoint().getRow() + 1;
                    String targetId = ctx.functionIdByName.get(callee);
                    if (targetId != null) {
                        ctx.edges.add(new RelationEdge(
                            caller.id(), targetId, EdgeKind.CALLS, true, ctx.filePath, sourceLine
                        ));
                    } else {
                        // 未解析的外部调用占位 ID；projectId / filePath 为空
                        // 因此不会与真实 CodeUnit ID 冲突
                        String bareId = CodeUnitIdUtil.computeId("", "", CodeUnitKind.FUNCTION, callee);
                        ctx.edges.add(new RelationEdge(
                            caller.id(), bareId, EdgeKind.CALLS, false, ctx.filePath, sourceLine
                        ));
                    }
                }
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (!child.isNull()) collectCalls(child, caller, ctx);
        }
    }

    // ── 声明符名称提取（递归解包）────────────────────────────────────────────

    /**
     * 递归解包 declarator 节点，提取真正的函数或变量名。
     *
     * <p>按 CLAUDE.md 规范递归处理以下包装节点：
     * pointer_declarator → 剥离 *，递归；
     * function_declarator → 取 declarator 字段，递归；
     * parenthesized_declarator → 取内部节点，递归；
     * 终止于 identifier 或 type_identifier。
     *
     * @param node declarator 节点
     * @param ctx  解析上下文，用于读取节点文本
     * @return 提取到的名称，找不到则返回 {@code null}
     */
    private String extractFunctionName(TSNode node, ParseContext ctx) {
        if (node == null || node.isNull()) return null;
        return switch (node.getType()) {
            case "identifier", "type_identifier" -> nodeText(node, ctx);
            case "function_declarator" -> {
                TSNode inner = node.getChildByFieldName("declarator");
                yield (inner != null && !inner.isNull()) ? extractFunctionName(inner, ctx) : null;
            }
            case "pointer_declarator", "abstract_pointer_declarator" -> {
                String found = null;
                for (int i = 0; i < node.getChildCount() && found == null; i++) {
                    TSNode child = node.getChild(i);
                    if (child.isNull()) continue;
                    String ct = child.getType();
                    if (!"*".equals(ct) && !"type_qualifier".equals(ct)) {
                        found = extractFunctionName(child, ctx);
                    }
                }
                yield found;
            }
            case "parenthesized_declarator" -> {
                String found = null;
                for (int i = 0; i < node.getChildCount() && found == null; i++) {
                    TSNode child = node.getChild(i);
                    if (child.isNull()) continue;
                    if (!"(".equals(child.getType()) && !")".equals(child.getType())) {
                        found = extractFunctionName(child, ctx);
                    }
                }
                yield found;
            }
            default -> {
                // 对未识别的声明符变体，递归遍历具名子节点
                String found = null;
                for (int i = 0; i < node.getNamedChildCount() && found == null; i++) {
                    TSNode child = node.getNamedChild(i);
                    if (!child.isNull()) found = extractFunctionName(child, ctx);
                }
                yield found;
            }
        };
    }

    private String extractSimpleName(TSNode declarator, ParseContext ctx) {
        String name = extractFunctionName(declarator, ctx);
        return name != null ? name : "";
    }

    // ── 参数提取 ──────────────────────────────────────────────────────────────

    private String extractParamTypes(TSNode declarator, ParseContext ctx) {
        TSNode funcDecl = findFunctionDeclarator(declarator);
        if (funcDecl == null) return "";
        TSNode params = funcDecl.getChildByFieldName("parameters");
        if (params == null || params.isNull()) return "";

        List<String> types = new ArrayList<>();
        for (int i = 0; i < params.getChildCount(); i++) {
            TSNode param = params.getChild(i);
            if (param.isNull()) continue;
            if ("parameter_declaration".equals(param.getType())) {
                TSNode typeNode = param.getChildByFieldName("type");
                if (typeNode != null && !typeNode.isNull()) {
                    types.add(nodeText(typeNode, ctx));
                }
            } else if ("variadic_parameter".equals(param.getType()) || "...".equals(param.getType())) {
                types.add("...");
            }
        }
        return String.join(",", types);
    }

    private TSNode findFunctionDeclarator(TSNode node) {
        if (node == null || node.isNull()) return null;
        if ("function_declarator".equals(node.getType())) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (!child.isNull()) {
                TSNode found = findFunctionDeclarator(child);
                if (found != null) return found;
            }
        }
        return null;
    }

    // ── 存储类修饰符辅助 ──────────────────────────────────────────────────────

    private boolean hasStorageClass(TSNode node, ParseContext ctx, String keyword) {
        TSNode typeNode = node.getChildByFieldName("type");
        if (typeNode != null && !typeNode.isNull() && nodeText(typeNode, ctx).contains(keyword)) {
            return true;
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (child.isNull()) continue;
            if ("storage_class_specifier".equals(child.getType()) &&
                keyword.equals(nodeText(child, ctx).trim())) {
                return true;
            }
        }
        return false;
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
        /** 文件内函数名 → ID 映射，用于解析文件内的 CALLS 边。 */
        final Map<String, String> functionIdByName = new HashMap<>();

        ParseContext(String filePath, byte[] sourceBytes, ParseOptions options) {
            this.filePath = filePath;
            this.projectId = options != null && options.projectId() != null ? options.projectId() : "";
            this.sourceBytes = sourceBytes;
            this.options = options;
        }
    }
}
