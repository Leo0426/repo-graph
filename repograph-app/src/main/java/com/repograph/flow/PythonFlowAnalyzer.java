package com.repograph.flow;

import com.repograph.core.flow.ControlFlowGraph;
import com.repograph.core.flow.DataFlowSummary;
import com.repograph.core.flow.FlowAnalysisResult;
import com.repograph.core.flow.FlowEdge;
import com.repograph.core.flow.FlowEdgeKind;
import com.repograph.core.flow.FlowNode;
import com.repograph.core.flow.FlowNodeKind;
import com.repograph.core.model.CodeUnit;
import org.treesitter.TSNode;

import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * 基于 Tree-sitter AST 的 Python 函数 CFG + 保守 DataFlowSummary 构建器。
 *
 * <p>不生成 PDG（动态类型语言可靠性低），以 {@code precise=false} 返回。
 */
final class PythonFlowAnalyzer {

    private final CodeUnit unit;
    private final TSNode block;     // block 节点（函数体）
    private final byte[] sourceBytes;

    private final List<FlowNode> nodes = new ArrayList<>();
    private final List<FlowEdge> cfgEdges = new ArrayList<>();
    private final List<String> terminalNodes = new ArrayList<>();
    private final Deque<LoopContext> loopContexts = new ArrayDeque<>();
    private final List<String> returnSources = new ArrayList<>();
    private int sequence;

    PythonFlowAnalyzer(CodeUnit unit, TSNode block, byte[] sourceBytes) {
        this.unit = unit;
        this.block = block;
        this.sourceBytes = sourceBytes;
    }

    FlowAnalysisResult analyze() {
        FlowNode entry = addNode(FlowNodeKind.ENTRY, "ENTRY", unit.startLine());
        List<Tail> tails = processBlock(block, List.of(new Tail(entry.id(), FlowEdgeKind.NEXT)));
        FlowNode exit = addNode(FlowNodeKind.EXIT, "EXIT", unit.endLine());
        connect(tails, exit.id());
        terminalNodes.forEach(id -> cfgEdges.add(edge(id, exit.id(), FlowEdgeKind.NEXT)));

        List<String> params = extractParamNames(unit.rawSource());
        DataFlowSummary summary = new DataFlowSummary(params, List.of(), List.of(),
                List.copyOf(returnSources));
        return new FlowAnalysisResult(
                unit.qualifiedName(), "python", summary,
                new ControlFlowGraph(List.copyOf(nodes), List.copyOf(cfgEdges)),
                null, false);
    }

    // ── 语句分发 ──────────────────────────────────────────────────────────────

    private List<Tail> processBlock(TSNode node, List<Tail> incoming) {
        if (node == null || node.isNull()) return incoming;
        List<Tail> tails = incoming;
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            if (tails.isEmpty()) break;
            TSNode child = node.getChild(i);
            if (!child.isNull()) tails = processStatement(child, tails);
        }
        return tails;
    }

    private List<Tail> processStatement(TSNode node, List<Tail> incoming) {
        return switch (node.getType()) {
            case "block"                   -> processBlock(node, incoming);
            case "if_statement"            -> processIf(node, incoming);
            case "for_statement"           -> processFor(node, incoming);
            case "async_for_statement"     -> processFor(node, incoming);
            case "while_statement"         -> processWhile(node, incoming);
            case "break_statement"         -> processBreak(node, incoming);
            case "continue_statement"      -> processContinue(node, incoming);
            case "return_statement"        -> processReturn(node, incoming);
            case "raise_statement"         -> processRaise(node, incoming);
            case "try_statement"           -> processTry(node, incoming);
            case "with_statement",
                 "async_with_statement"    -> processWith(node, incoming);
            case "match_statement"         -> processGeneric(node, incoming);
            // 跳过非可执行 token
            case "comment", "pass_statement", "decorator", "string", "integer",
                 "float", "none", "true", "false" -> incoming;
            default                        -> processGeneric(node, incoming);
        };
    }

    // ── 控制流结构 ────────────────────────────────────────────────────────────

    private List<Tail> processIf(TSNode node, List<Tail> incoming) {
        TSNode condNode = node.getChildByFieldName("condition");
        String condLabel = condNode != null && !condNode.isNull()
                ? compact(nodeText(condNode)) : "condition";
        int line = row(node);
        FlowNode cond = addNode(FlowNodeKind.CONDITION, condLabel, line);
        connect(incoming, cond.id());

        TSNode consequence = node.getChildByFieldName("consequence");
        List<Tail> allExits = new ArrayList<>(consequence != null && !consequence.isNull()
                ? processBlock(consequence, List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH)))
                : List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH)));

        // 遍历子节点处理 elif_clause / else_clause
        List<Tail> prevFalse = List.of(new Tail(cond.id(), FlowEdgeKind.FALSE_BRANCH));
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            TSNode child = node.getChild(i);
            if (child.isNull()) continue;
            switch (child.getType()) {
                case "elif_clause" -> {
                    TSNode ec = child.getChildByFieldName("condition");
                    String eLabel = ec != null && !ec.isNull() ? compact(nodeText(ec)) : "condition";
                    FlowNode eNode = addNode(FlowNodeKind.CONDITION, eLabel, row(child));
                    connect(prevFalse, eNode.id());
                    TSNode eBody = elifBody(child);
                    allExits.addAll(eBody != null
                            ? processBlock(eBody, List.of(new Tail(eNode.id(), FlowEdgeKind.TRUE_BRANCH)))
                            : List.of(new Tail(eNode.id(), FlowEdgeKind.TRUE_BRANCH)));
                    prevFalse = List.of(new Tail(eNode.id(), FlowEdgeKind.FALSE_BRANCH));
                }
                case "else_clause" -> {
                    TSNode elseBlock = findBlock(child);
                    if (elseBlock != null) allExits.addAll(processBlock(elseBlock, prevFalse));
                    else allExits.addAll(prevFalse);
                    prevFalse = List.of();
                }
                default -> { /* 跳过结构性 token */ }
            }
        }
        allExits.addAll(prevFalse);
        return allExits;
    }

    private List<Tail> processFor(TSNode node, List<Tail> incoming) {
        TSNode rightNode = node.getChildByFieldName("right");
        String iterLabel = rightNode != null && !rightNode.isNull()
                ? "for " + compact(nodeText(rightNode)) : "for";
        int line = row(node);
        FlowNode cond = addNode(FlowNodeKind.CONDITION, iterLabel, line);
        connect(incoming, cond.id());

        LoopContext loop = new LoopContext();
        loopContexts.push(loop);
        TSNode bodyNode = node.getChildByFieldName("body");
        List<Tail> bodyTails = bodyNode != null && !bodyNode.isNull()
                ? processBlock(bodyNode, List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH)))
                : List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH));
        loopContexts.pop();

        List<Tail> loopBack = new ArrayList<>(bodyTails);
        loopBack.addAll(loop.continueTails);
        loopBack.forEach(t -> cfgEdges.add(edge(t.id(), cond.id(), FlowEdgeKind.LOOP_BACK)));

        List<Tail> exits = new ArrayList<>();
        exits.add(new Tail(cond.id(), FlowEdgeKind.FALSE_BRANCH));
        exits.addAll(loop.breakTails);

        // for … else 子句
        TSNode alt = node.getChildByFieldName("alternative");
        if (alt != null && !alt.isNull()) {
            TSNode elseBlock = findBlock(alt);
            if (elseBlock != null) exits = processBlock(elseBlock, exits);
        }
        return exits;
    }

    private List<Tail> processWhile(TSNode node, List<Tail> incoming) {
        TSNode condNode = node.getChildByFieldName("condition");
        String condLabel = condNode != null && !condNode.isNull()
                ? compact(nodeText(condNode)) : "condition";
        int line = row(node);
        FlowNode cond = addNode(FlowNodeKind.CONDITION, condLabel, line);
        connect(incoming, cond.id());

        LoopContext loop = new LoopContext();
        loopContexts.push(loop);
        TSNode bodyNode = node.getChildByFieldName("body");
        List<Tail> bodyTails = bodyNode != null && !bodyNode.isNull()
                ? processBlock(bodyNode, List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH)))
                : List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH));
        loopContexts.pop();

        List<Tail> loopBack = new ArrayList<>(bodyTails);
        loopBack.addAll(loop.continueTails);
        loopBack.forEach(t -> cfgEdges.add(edge(t.id(), cond.id(), FlowEdgeKind.LOOP_BACK)));

        List<Tail> exits = new ArrayList<>();
        exits.add(new Tail(cond.id(), FlowEdgeKind.FALSE_BRANCH));
        exits.addAll(loop.breakTails);
        return exits;
    }

    private List<Tail> processTry(TSNode node, List<Tail> incoming) {
        // try 体：第一个 block 子节点
        TSNode tryBlock = findBlock(node);
        List<Tail> tryTails = tryBlock != null ? processBlock(tryBlock, incoming) : incoming;

        List<Tail> allExits = new ArrayList<>(tryTails);

        // 每个 except_clause 均从 try 入口分出（保守近似：任意语句均可抛出）
        List<Tail> exceptEntry = new ArrayList<>(incoming);
        TSNode finallyBlock = null;

        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            TSNode child = node.getChild(i);
            if (child.isNull()) continue;
            switch (child.getType()) {
                case "except_clause", "except_group_clause" -> {
                    TSNode excBlock = findBlock(child);
                    if (excBlock != null) allExits.addAll(processBlock(excBlock, exceptEntry));
                }
                case "else_clause" -> {
                    TSNode elseBlock = findBlock(child);
                    if (elseBlock != null) allExits = processBlock(elseBlock, allExits);
                }
                case "finally_clause" -> finallyBlock = findBlock(child);
                default -> { /* 跳过 */ }
            }
        }

        if (finallyBlock != null) {
            allExits = processBlock(finallyBlock, allExits);
        }
        return allExits;
    }

    private List<Tail> processWith(TSNode node, List<Tail> incoming) {
        TSNode bodyNode = node.getChildByFieldName("body");
        if (bodyNode == null || bodyNode.isNull()) bodyNode = findBlock(node);
        return bodyNode != null ? processBlock(bodyNode, incoming) : processGeneric(node, incoming);
    }

    private List<Tail> processBreak(TSNode node, List<Tail> incoming) {
        int line = row(node);
        FlowNode n = addNode(FlowNodeKind.STATEMENT, "break", line);
        connect(incoming, n.id());
        LoopContext ctx = loopContexts.peek();
        if (ctx != null) ctx.breakTails.add(new Tail(n.id(), FlowEdgeKind.NEXT));
        else return List.of(new Tail(n.id(), FlowEdgeKind.NEXT));
        return List.of();
    }

    private List<Tail> processContinue(TSNode node, List<Tail> incoming) {
        int line = row(node);
        FlowNode n = addNode(FlowNodeKind.STATEMENT, "continue", line);
        connect(incoming, n.id());
        LoopContext ctx = loopContexts.peek();
        if (ctx != null) ctx.continueTails.add(new Tail(n.id(), FlowEdgeKind.NEXT));
        else return List.of(new Tail(n.id(), FlowEdgeKind.NEXT));
        return List.of();
    }

    private List<Tail> processReturn(TSNode node, List<Tail> incoming) {
        int line = row(node);
        FlowNode ret = addNode(FlowNodeKind.RETURN, compact(nodeText(node)), line);
        connect(incoming, ret.id());
        collectReturnSources(node);
        terminalNodes.add(ret.id());
        return List.of();
    }

    private List<Tail> processRaise(TSNode node, List<Tail> incoming) {
        int line = row(node);
        FlowNode n = addNode(FlowNodeKind.THROW, compact(nodeText(node)), line);
        connect(incoming, n.id());
        terminalNodes.add(n.id());
        return List.of();
    }

    private List<Tail> processGeneric(TSNode node, List<Tail> incoming) {
        String text = nodeText(node).strip();
        if (text.isEmpty()) return incoming;
        int line = row(node);
        FlowNode n = addNode(FlowNodeKind.STATEMENT, compact(text), line);
        connect(incoming, n.id());
        return List.of(new Tail(n.id(), FlowEdgeKind.NEXT));
    }

    // ── 返回值来源收集 ────────────────────────────────────────────────────────

    private void collectReturnSources(TSNode returnNode) {
        for (int i = 0; i < returnNode.getChildCount(); i++) {
            TSNode child = returnNode.getChild(i);
            if (!child.isNull() && !"return".equals(child.getType())) {
                collectIdentifiers(child);
            }
        }
    }

    private void collectIdentifiers(TSNode node) {
        if (node.isNull()) return;
        if ("identifier".equals(node.getType())) {
            returnSources.add(nodeText(node));
            return;
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            TSNode child = node.getChild(i);
            if (!child.isNull()) collectIdentifiers(child);
        }
    }

    // ── AST 导航辅助方法 ──────────────────────────────────────────────────────

    /** 找到节点的第一个类型为 {@code block} 的子节点。 */
    private static TSNode findBlock(TSNode parent) {
        for (int i = 0; i < parent.getChildCount(); i++) {
            TSNode child = parent.getChild(i);
            if (!child.isNull() && "block".equals(child.getType())) return child;
        }
        return null;
    }

    /** 返回 elif_clause 的 body block（字段 {@code consequence} 或 {@code body}）。 */
    private TSNode elifBody(TSNode elifClause) {
        TSNode body = elifClause.getChildByFieldName("consequence");
        if (body != null && !body.isNull()) return body;
        body = elifClause.getChildByFieldName("body");
        if (body != null && !body.isNull()) return body;
        return findBlock(elifClause);
    }

    private String nodeText(TSNode node) {
        int start = node.getStartByte();
        int end = node.getEndByte();
        if (start < 0 || end > sourceBytes.length || start >= end) return "";
        return new String(sourceBytes, start, end - start, StandardCharsets.UTF_8);
    }

    private int row(TSNode node) {
        return node.getStartPoint().getRow() + 1 + unit.startLine() - 1;
    }

    private static String compact(String s) {
        String c = s.replaceAll("\\s+", " ").strip();
        return c.length() <= 120 ? c : c.substring(0, 117) + "...";
    }

    private FlowNode addNode(FlowNodeKind kind, String label, int line) {
        FlowNode n = new FlowNode("py" + sequence++, kind, label, line);
        nodes.add(n);
        return n;
    }

    private void connect(List<Tail> tails, String targetId) {
        tails.forEach(t -> cfgEdges.add(edge(t.id(), targetId, t.kind())));
    }

    private static FlowEdge edge(String src, String tgt, FlowEdgeKind kind) {
        return new FlowEdge(src, tgt, kind, "");
    }

    // ── 参数名提取 ────────────────────────────────────────────────────────────

    static List<String> extractParamNames(String rawSource) {
        if (rawSource == null || rawSource.isBlank()) return List.of();
        int defIdx = rawSource.indexOf("def ");
        if (defIdx < 0) return List.of();
        int open = rawSource.indexOf('(', defIdx);
        if (open < 0) return List.of();
        int close = findMatchingParen(rawSource, open);
        if (close < 0) return List.of();
        String params = rawSource.substring(open + 1, close).strip();
        if (params.isEmpty()) return List.of();

        List<String> names = new ArrayList<>();
        for (String part : params.split(",")) {
            String p = part.strip();
            if (p.isEmpty() || "/".equals(p) || "*".equals(p)) continue;
            // 去除类型注解
            int colon = p.indexOf(':');
            if (colon > 0) p = p.substring(0, colon).strip();
            // 去除默认值
            int eq = p.indexOf('=');
            if (eq > 0) p = p.substring(0, eq).strip();
            // 去除 * / **
            p = p.replaceFirst("^\\*+", "").strip();
            if (!p.isEmpty()) names.add(p);
        }
        return List.copyOf(names);
    }

    private static int findMatchingParen(String s, int open) {
        int depth = 0;
        for (int i = open; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '(') depth++;
            else if (c == ')') { if (--depth == 0) return i; }
        }
        return -1;
    }

    // ── 内部类型 ──────────────────────────────────────────────────────────────

    private record Tail(String id, FlowEdgeKind kind) {}

    private static final class LoopContext {
        final List<Tail> breakTails = new ArrayList<>();
        final List<Tail> continueTails = new ArrayList<>();
    }
}
