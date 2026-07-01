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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 基于 Tree-sitter AST 的 C 函数 CFG + 保守 DataFlowSummary 构建器。
 *
 * <p>不生成 PDG（指针别名分析在无类型信息时可靠性低），以 {@code precise=false} 返回。
 */
final class CFlowAnalyzer {

    private static final Pattern PARAM_NAME = Pattern.compile("\\b(\\w+)\\s*$");

    private final CodeUnit unit;
    private final TSNode body;
    private final byte[] sourceBytes;

    private final List<FlowNode> nodes = new ArrayList<>();
    private final List<FlowEdge> cfgEdges = new ArrayList<>();
    private final List<String> terminalNodes = new ArrayList<>();
    private final Deque<LoopContext> loopContexts = new ArrayDeque<>();
    private final List<String> returnSources = new ArrayList<>();
    private int sequence;

    CFlowAnalyzer(CodeUnit unit, TSNode body, byte[] sourceBytes) {
        this.unit = unit;
        this.body = body;
        this.sourceBytes = sourceBytes;
    }

    FlowAnalysisResult analyze() {
        FlowNode entry = addNode(FlowNodeKind.ENTRY, "ENTRY", unit.startLine());
        List<Tail> tails = processCompound(body, List.of(new Tail(entry.id(), FlowEdgeKind.NEXT)));
        FlowNode exit = addNode(FlowNodeKind.EXIT, "EXIT", unit.endLine());
        connect(tails, exit.id());
        terminalNodes.forEach(id -> cfgEdges.add(edge(id, exit.id(), FlowEdgeKind.NEXT)));

        List<String> params = extractParamNames(unit.rawSource());
        DataFlowSummary summary = new DataFlowSummary(params, List.of(), List.of(),
                List.copyOf(returnSources));
        return new FlowAnalysisResult(
                unit.qualifiedName(), "c", summary,
                new ControlFlowGraph(List.copyOf(nodes), List.copyOf(cfgEdges)),
                null, false);
    }

    // ── 语句分发 ──────────────────────────────────────────────────────────────

    private List<Tail> processCompound(TSNode node, List<Tail> incoming) {
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
            case "compound_statement"  -> processCompound(node, incoming);
            case "if_statement"        -> processIf(node, incoming);
            case "for_statement"       -> processFor(node, incoming);
            case "while_statement"     -> processWhile(node, incoming);
            case "do_statement"        -> processDoWhile(node, incoming);
            case "break_statement"     -> processBreak(node, incoming);
            case "continue_statement"  -> processContinue(node, incoming);
            case "switch_statement"    -> processSwitch(node, incoming);
            case "case_statement"      -> processCaseStatement(node, incoming);
            case "return_statement"    -> processReturn(node, incoming);
            // 结构性 / 非可执行 token
            case "comment", ";", "{", "}", "preproc_if", "preproc_ifdef",
                 "preproc_else", "preproc_endif" -> incoming;
            default                    -> processGeneric(node, incoming);
        };
    }

    private List<Tail> processCaseStatement(TSNode node, List<Tail> incoming) {
        // 跳过 'case'/'default' 关键字、值表达式和 ':'，然后处理 body 语句
        boolean afterColon = false;
        List<Tail> tails = incoming;
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            if (tails.isEmpty()) break;
            TSNode child = node.getChild(i);
            if (child.isNull()) continue;
            if (":".equals(child.getType())) { afterColon = true; continue; }
            if (afterColon) tails = processStatement(child, tails);
        }
        return tails;
    }

    // ── 控制流结构 ────────────────────────────────────────────────────────────

    private List<Tail> processIf(TSNode node, List<Tail> incoming) {
        TSNode condNode = node.getChildByFieldName("condition");
        String condLabel = condNode != null && !condNode.isNull()
                ? compact(nodeText(condNode)) : "condition";
        int line = node.getStartPoint().getRow() + 1 + unit.startLine() - 1;
        FlowNode cond = addNode(FlowNodeKind.CONDITION, condLabel, line);
        connect(incoming, cond.id());

        TSNode consequence = node.getChildByFieldName("consequence");
        List<Tail> thenTails = consequence != null && !consequence.isNull()
                ? processStatement(consequence, List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH)))
                : List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH));

        TSNode alternative = node.getChildByFieldName("alternative");
        List<Tail> elseTails;
        if (alternative != null && !alternative.isNull()) {
            elseTails = processStatement(alternative, List.of(new Tail(cond.id(), FlowEdgeKind.FALSE_BRANCH)));
        } else {
            elseTails = List.of(new Tail(cond.id(), FlowEdgeKind.FALSE_BRANCH));
        }

        List<Tail> combined = new ArrayList<>(thenTails);
        combined.addAll(elseTails);
        return combined;
    }

    private List<Tail> processFor(TSNode node, List<Tail> incoming) {
        // 初始化语句
        TSNode init = node.getChildByFieldName("initializer");
        List<Tail> initTails = incoming;
        if (init != null && !init.isNull()) {
            int line = init.getStartPoint().getRow() + 1 + unit.startLine() - 1;
            FlowNode initNode = addNode(FlowNodeKind.STATEMENT, compact(nodeText(init)), line);
            connect(incoming, initNode.id());
            initTails = List.of(new Tail(initNode.id(), FlowEdgeKind.NEXT));
        }

        // 条件节点
        TSNode condNode = node.getChildByFieldName("condition");
        String condLabel = condNode != null && !condNode.isNull()
                ? compact(nodeText(condNode)) : "true";
        int line = node.getStartPoint().getRow() + 1 + unit.startLine() - 1;
        FlowNode cond = addNode(FlowNodeKind.CONDITION, condLabel, line);
        connect(initTails, cond.id());

        LoopContext loop = new LoopContext();
        loopContexts.push(loop);
        TSNode bodyNode = node.getChildByFieldName("body");
        List<Tail> bodyTails = bodyNode != null && !bodyNode.isNull()
                ? processStatement(bodyNode, List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH)))
                : List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH));
        loopContexts.pop();

        // 更新语句
        TSNode update = node.getChildByFieldName("update");
        List<Tail> loopBackTails = new ArrayList<>(bodyTails);
        loopBackTails.addAll(loop.continueTails);
        if (update != null && !update.isNull()) {
            int uline = update.getStartPoint().getRow() + 1 + unit.startLine() - 1;
            FlowNode updateNode = addNode(FlowNodeKind.STATEMENT, compact(nodeText(update)), uline);
            connect(loopBackTails, updateNode.id());
            cfgEdges.add(edge(updateNode.id(), cond.id(), FlowEdgeKind.LOOP_BACK));
        } else {
            loopBackTails.forEach(t -> cfgEdges.add(edge(t.id(), cond.id(), FlowEdgeKind.LOOP_BACK)));
        }

        List<Tail> exits = new ArrayList<>();
        exits.add(new Tail(cond.id(), FlowEdgeKind.FALSE_BRANCH));
        exits.addAll(loop.breakTails);
        return exits;
    }

    private List<Tail> processWhile(TSNode node, List<Tail> incoming) {
        TSNode condNode = node.getChildByFieldName("condition");
        String condLabel = condNode != null && !condNode.isNull()
                ? compact(nodeText(condNode)) : "condition";
        int line = node.getStartPoint().getRow() + 1 + unit.startLine() - 1;
        FlowNode cond = addNode(FlowNodeKind.CONDITION, condLabel, line);
        connect(incoming, cond.id());

        LoopContext loop = new LoopContext();
        loopContexts.push(loop);
        TSNode bodyNode = node.getChildByFieldName("body");
        List<Tail> bodyTails = bodyNode != null && !bodyNode.isNull()
                ? processStatement(bodyNode, List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH)))
                : List.of(new Tail(cond.id(), FlowEdgeKind.TRUE_BRANCH));
        loopContexts.pop();

        List<Tail> loopBackTails = new ArrayList<>(bodyTails);
        loopBackTails.addAll(loop.continueTails);
        loopBackTails.forEach(t -> cfgEdges.add(edge(t.id(), cond.id(), FlowEdgeKind.LOOP_BACK)));

        List<Tail> exits = new ArrayList<>();
        exits.add(new Tail(cond.id(), FlowEdgeKind.FALSE_BRANCH));
        exits.addAll(loop.breakTails);
        return exits;
    }

    private List<Tail> processDoWhile(TSNode node, List<Tail> incoming) {
        LoopContext loop = new LoopContext();
        loopContexts.push(loop);
        TSNode bodyNode = node.getChildByFieldName("body");
        List<Tail> bodyTails = bodyNode != null && !bodyNode.isNull()
                ? processStatement(bodyNode, incoming)
                : incoming;
        loopContexts.pop();

        TSNode condNode = node.getChildByFieldName("condition");
        String condLabel = condNode != null && !condNode.isNull()
                ? compact(nodeText(condNode)) : "condition";
        int line = node.getStartPoint().getRow() + 1 + unit.startLine() - 1;
        FlowNode cond = addNode(FlowNodeKind.CONDITION, condLabel, line);

        List<Tail> toCond = new ArrayList<>(bodyTails);
        toCond.addAll(loop.continueTails);
        connect(toCond, cond.id());

        // 回环边：TRUE 分支回到 body 入口
        if (!nodes.isEmpty()) {
            cfgEdges.add(edge(cond.id(), nodes.get(0).id(), FlowEdgeKind.LOOP_BACK));
        }

        List<Tail> exits = new ArrayList<>();
        exits.add(new Tail(cond.id(), FlowEdgeKind.FALSE_BRANCH));
        exits.addAll(loop.breakTails);
        return exits;
    }

    private List<Tail> processSwitch(TSNode node, List<Tail> incoming) {
        TSNode valueNode = node.getChildByFieldName("value");
        String label = valueNode != null && !valueNode.isNull()
                ? "switch(" + compact(nodeText(valueNode)) + ")" : "switch";
        int line = node.getStartPoint().getRow() + 1 + unit.startLine() - 1;
        FlowNode switchNode = addNode(FlowNodeKind.CONDITION, label, line);
        connect(incoming, switchNode.id());

        LoopContext loop = new LoopContext();
        loopContexts.push(loop);

        TSNode bodyNode = node.getChildByFieldName("body");
        List<Tail> fallTails = List.of(new Tail(switchNode.id(), FlowEdgeKind.NEXT));
        if (bodyNode != null && !bodyNode.isNull()) {
            fallTails = processCompound(bodyNode, fallTails);
        }
        loopContexts.pop();

        List<Tail> exits = new ArrayList<>(fallTails);
        exits.addAll(loop.breakTails);
        return exits;
    }

    private List<Tail> processReturn(TSNode node, List<Tail> incoming) {
        int line = node.getStartPoint().getRow() + 1 + unit.startLine() - 1;
        FlowNode ret = addNode(FlowNodeKind.RETURN, compact(nodeText(node)), line);
        connect(incoming, ret.id());
        collectReturnSource(node);
        terminalNodes.add(ret.id());
        return List.of();
    }

    private List<Tail> processBreak(TSNode node, List<Tail> incoming) {
        int line = node.getStartPoint().getRow() + 1 + unit.startLine() - 1;
        FlowNode n = addNode(FlowNodeKind.STATEMENT, "break", line);
        connect(incoming, n.id());
        LoopContext ctx = loopContexts.peek();
        if (ctx != null) ctx.breakTails.add(new Tail(n.id(), FlowEdgeKind.NEXT));
        else return List.of(new Tail(n.id(), FlowEdgeKind.NEXT));
        return List.of();
    }

    private List<Tail> processContinue(TSNode node, List<Tail> incoming) {
        int line = node.getStartPoint().getRow() + 1 + unit.startLine() - 1;
        FlowNode n = addNode(FlowNodeKind.STATEMENT, "continue", line);
        connect(incoming, n.id());
        LoopContext ctx = loopContexts.peek();
        if (ctx != null) ctx.continueTails.add(new Tail(n.id(), FlowEdgeKind.NEXT));
        else return List.of(new Tail(n.id(), FlowEdgeKind.NEXT));
        return List.of();
    }

    private List<Tail> processGeneric(TSNode node, List<Tail> incoming) {
        String text = nodeText(node).strip();
        if (text.isEmpty()) return incoming;
        int line = node.getStartPoint().getRow() + 1 + unit.startLine() - 1;
        FlowNode n = addNode(FlowNodeKind.STATEMENT, compact(text), line);
        connect(incoming, n.id());
        return List.of(new Tail(n.id(), FlowEdgeKind.NEXT));
    }

    // ── 辅助方法 ──────────────────────────────────────────────────────────────

    private void collectReturnSource(TSNode returnNode) {
        for (int i = 0; i < returnNode.getChildCount(); i++) {
            TSNode child = returnNode.getChild(i);
            if (child.isNull()) continue;
            String type = child.getType();
            if ("return".equals(type) || ";".equals(type)) continue;
            // 收集标识符节点作为返回值来源
            collectIdentifiers(child);
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

    private String nodeText(TSNode node) {
        int start = node.getStartByte();
        int end = node.getEndByte();
        if (start < 0 || end > sourceBytes.length || start >= end) return "";
        return new String(sourceBytes, start, end - start, StandardCharsets.UTF_8);
    }

    private static String compact(String s) {
        String c = s.replaceAll("\\s+", " ").strip();
        return c.length() <= 120 ? c : c.substring(0, 117) + "...";
    }

    private FlowNode addNode(FlowNodeKind kind, String label, int line) {
        FlowNode n = new FlowNode("c" + sequence++, kind, label, line);
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
        // 提取左大括号前的参数列表
        int brace = rawSource.indexOf('{');
        String sig = brace > 0 ? rawSource.substring(0, brace) : rawSource;
        int open = sig.indexOf('(');
        int close = sig.lastIndexOf(')');
        if (open < 0 || close <= open) return List.of();
        String params = sig.substring(open + 1, close).strip();
        if (params.isEmpty() || "void".equals(params)) return List.of();

        List<String> names = new ArrayList<>();
        for (String param : params.split(",")) {
            String p = param.strip();
            if (p.isEmpty() || "...".equals(p)) continue;
            // 去除数组括号和指针星号以提取参数名
            p = p.replaceAll("\\[.*?]", "").replaceAll("[*&]", " ").strip();
            Matcher m = PARAM_NAME.matcher(p);
            if (m.find()) names.add(m.group(1));
        }
        return List.copyOf(names);
    }

    // ── 内部类型 ──────────────────────────────────────────────────────────────

    private record Tail(String id, FlowEdgeKind kind) {}

    private static final class LoopContext {
        final List<Tail> breakTails = new ArrayList<>();
        final List<Tail> continueTails = new ArrayList<>();
    }
}
