package com.repograph.flow;

import com.github.javaparser.ast.nodeTypes.NodeWithSimpleName;
import com.repograph.core.flow.ControlFlowGraph;
import com.repograph.core.flow.DataFlowSummary;
import com.repograph.core.flow.FlowAnalysisResult;
import com.repograph.core.flow.FlowEdge;
import com.repograph.core.flow.FlowEdgeKind;
import com.repograph.core.flow.FlowNode;
import com.repograph.core.flow.FlowNodeKind;
import com.repograph.core.flow.ProgramDependenceGraph;
import com.repograph.core.model.CodeUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.AssignExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.UnaryExpr;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.BreakStmt;
import com.github.javaparser.ast.stmt.CatchClause;
import com.github.javaparser.ast.stmt.ContinueStmt;
import com.github.javaparser.ast.stmt.DoStmt;
import com.github.javaparser.ast.stmt.ForEachStmt;
import com.github.javaparser.ast.stmt.ForStmt;
import com.github.javaparser.ast.stmt.IfStmt;
import com.github.javaparser.ast.stmt.LabeledStmt;
import com.github.javaparser.ast.stmt.ReturnStmt;
import com.github.javaparser.ast.stmt.Statement;
import com.github.javaparser.ast.stmt.SwitchEntry;
import com.github.javaparser.ast.stmt.SwitchStmt;
import com.github.javaparser.ast.stmt.TryStmt;
import com.github.javaparser.ast.stmt.WhileStmt;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 方法级控制流 / 数据流图构建器。按需创建，不缓存结果。
 */
final class JavaFlowAnalyzer {

    private final CodeUnit unit;
    private final CallableDeclaration<?> callable;
    private final BlockStmt body;
    private final List<FlowNode> nodes = new ArrayList<>();
    private final List<FlowEdge> cfgEdges = new ArrayList<>();
    private final List<FlowEdge> dependencyEdges = new ArrayList<>();
    private final Map<String, String> lastDefinitions = new LinkedHashMap<>();
    private final Set<String> fieldReads = new LinkedHashSet<>();
    private final Set<String> fieldWrites = new LinkedHashSet<>();
    private final Set<String> returnSources = new LinkedHashSet<>();
    private final List<String> terminalNodes = new ArrayList<>();
    private final Deque<LoopContext> loopContexts = new ArrayDeque<>();
    private int sequence;

    JavaFlowAnalyzer(CodeUnit unit, CallableDeclaration<?> callable, BlockStmt body) {
        this.unit = unit;
        this.callable = callable;
        this.body = body;
    }

    FlowAnalysisResult analyze() {
        FlowNode entry = addNode(FlowNodeKind.ENTRY, "ENTRY", unit.startLine());
        List<String> parameters = callable.getParameters().stream()
                .map(NodeWithSimpleName::getNameAsString)
                .toList();
        parameters.forEach(parameter -> lastDefinitions.put(parameter, entry.id()));

        List<Tail> tails = processStatements(body.getStatements(), List.of(new Tail(entry.id(),
                FlowEdgeKind.NEXT)));
        FlowNode exit = addNode(FlowNodeKind.EXIT, "EXIT", Math.max(unit.startLine(), unit.endLine()));
        connect(tails, exit.id());
        terminalNodes.forEach(id -> cfgEdges.add(edge(id, exit.id(), FlowEdgeKind.NEXT, "")));

        collectSummaryFacts();
        DataFlowSummary summary = new DataFlowSummary(
                List.copyOf(parameters),
                List.copyOf(fieldReads),
                List.copyOf(fieldWrites),
                List.copyOf(returnSources));
        List<FlowNode> immutableNodes = List.copyOf(nodes);
        return new FlowAnalysisResult(
                unit.qualifiedName(),
                unit.language(),
                summary,
                new ControlFlowGraph(immutableNodes, List.copyOf(cfgEdges)),
                new ProgramDependenceGraph(immutableNodes, List.copyOf(dependencyEdges)),
                true);
    }

    private List<Tail> processStatements(List<Statement> statements, List<Tail> incoming) {
        List<Tail> tails = incoming;
        for (Statement statement : statements) {
            if (tails.isEmpty()) break;
            tails = processStatement(statement, tails);
        }
        return tails;
    }

    private List<Tail> processStatement(Statement statement, List<Tail> incoming) {
        if (statement.isBlockStmt()) {
            return processStatements(statement.asBlockStmt().getStatements(), incoming);
        }
        if (statement.isLabeledStmt()) {
            return processStatement(statement.asLabeledStmt().getStatement(), incoming);
        }
        if (statement.isIfStmt()) return processIf(statement.asIfStmt(), incoming);
        if (statement.isWhileStmt()) return processWhile(statement.asWhileStmt(), incoming);
        if (statement.isDoStmt()) return processDoWhile(statement.asDoStmt(), incoming);
        if (statement.isForStmt()) return processFor(statement.asForStmt(), incoming);
        if (statement.isForEachStmt()) return processForEach(statement.asForEachStmt(), incoming);
        if (statement.isBreakStmt()) return processBreak(statement.asBreakStmt(), incoming);
        if (statement.isContinueStmt()) return processContinue(statement.asContinueStmt(), incoming);
        if (statement.isSwitchStmt()) return processSwitch(statement.asSwitchStmt(), incoming);
        if (statement.isTryStmt()) return processTry(statement.asTryStmt(), incoming);

        FlowNodeKind kind = statement.isReturnStmt() ? FlowNodeKind.RETURN
                : statement.isThrowStmt() ? FlowNodeKind.THROW : FlowNodeKind.STATEMENT;
        FlowNode node = addStatementNode(kind, statement, incoming);
        if (kind == FlowNodeKind.RETURN || kind == FlowNodeKind.THROW) {
            terminalNodes.add(node.id());
            return List.of();
        }
        return List.of(new Tail(node.id(), FlowEdgeKind.NEXT));
    }

    private List<Tail> processIf(IfStmt statement, List<Tail> incoming) {
        FlowNode condition = addNode(FlowNodeKind.CONDITION,
                compact(statement.getCondition().toString()), absoluteLine(statement));
        connect(incoming, condition.id());
        addDataDependencies(condition, statement.getCondition());

        int thenStart = nodes.size();
        List<Tail> thenTails = processBranch(statement.getThenStmt(),
                new Tail(condition.id(), FlowEdgeKind.TRUE_BRANCH));
        addControlDependencies(condition.id(), thenStart);

        List<Tail> elseTails;
        if (statement.getElseStmt().isPresent()) {
            int elseStart = nodes.size();
            elseTails = processBranch(statement.getElseStmt().orElseThrow(),
                    new Tail(condition.id(), FlowEdgeKind.FALSE_BRANCH));
            addControlDependencies(condition.id(), elseStart);
        } else {
            elseTails = List.of(new Tail(condition.id(), FlowEdgeKind.FALSE_BRANCH));
        }
        List<Tail> combined = new ArrayList<>(thenTails);
        combined.addAll(elseTails);
        return combined;
    }

    private List<Tail> processWhile(WhileStmt statement, List<Tail> incoming) {
        return processPreTestLoop(statement, statement.getCondition(), statement.getBody(), incoming);
    }

    private List<Tail> processDoWhile(DoStmt statement, List<Tail> incoming) {
        int bodyStart = nodes.size();
        LoopContext loop = new LoopContext(loopLabel(statement), false);
        loopContexts.push(loop);
        List<Tail> bodyTails = processBranch(statement.getBody(), incoming);
        loopContexts.pop();

        FlowNode condition = addNode(FlowNodeKind.CONDITION,
                compact(statement.getCondition().toString()), absoluteLine(statement.getCondition()));
        connect(bodyTails, condition.id());
        connect(loop.continueTails, condition.id());
        addDataDependencies(condition, statement.getCondition());

        String bodyEntry = bodyStart < nodes.size() - 1
                ? nodes.get(bodyStart).id()
                : condition.id();
        cfgEdges.add(edge(condition.id(), bodyEntry, FlowEdgeKind.TRUE_BRANCH, ""));
        addControlDependencies(condition.id(), bodyStart, nodes.size() - 1);

        List<Tail> exits = new ArrayList<>();
        exits.add(new Tail(condition.id(), FlowEdgeKind.FALSE_BRANCH));
        exits.addAll(loop.breakTails);
        return exits;
    }

    private List<Tail> processFor(ForStmt statement, List<Tail> incoming) {
        List<Tail> initializerTails = processExpressions(statement.getInitialization(), incoming);
        Expression condition = statement.getCompare()
                .orElseGet(() -> new NameExpr("true"));
        FlowNode conditionNode = addNode(FlowNodeKind.CONDITION,
                compact(condition.toString()), absoluteLine(statement));
        connect(initializerTails, conditionNode.id());
        addDataDependencies(conditionNode, condition);

        int bodyStart = nodes.size();
        LoopContext loop = new LoopContext(loopLabel(statement), false);
        loopContexts.push(loop);
        List<Tail> bodyTails = processBranch(statement.getBody(),
                new Tail(conditionNode.id(), FlowEdgeKind.TRUE_BRANCH));
        loopContexts.pop();
        addControlDependencies(conditionNode.id(), bodyStart);

        List<Tail> loopBackTails = new ArrayList<>(bodyTails);
        loopBackTails.addAll(loop.continueTails);
        if (statement.getUpdate().isEmpty()) {
            connectAsLoopBack(loopBackTails, conditionNode.id());
        } else {
            List<Tail> updateTails = processExpressions(statement.getUpdate(), loopBackTails);
            connectAsLoopBack(updateTails, conditionNode.id());
        }

        List<Tail> exits = new ArrayList<>();
        exits.add(new Tail(conditionNode.id(), FlowEdgeKind.FALSE_BRANCH));
        exits.addAll(loop.breakTails);
        return exits;
    }

    private List<Tail> processForEach(ForEachStmt statement, List<Tail> incoming) {
        return processPreTestLoop(statement, statement.getIterable(), statement.getBody(), incoming);
    }

    private List<Tail> processPreTestLoop(Node owner, Expression conditionExpression,
                                          Statement loopBody, List<Tail> incoming) {
        FlowNode condition = addNode(FlowNodeKind.CONDITION,
                compact(conditionExpression.toString()), absoluteLine(owner));
        connect(incoming, condition.id());
        addDataDependencies(condition, conditionExpression);

        int bodyStart = nodes.size();
        LoopContext loop = new LoopContext(loopLabel(owner), false);
        loopContexts.push(loop);
        List<Tail> bodyTails = processBranch(loopBody,
                new Tail(condition.id(), FlowEdgeKind.TRUE_BRANCH));
        loopContexts.pop();
        addControlDependencies(condition.id(), bodyStart);
        connectAsLoopBack(bodyTails, condition.id());
        connectAsLoopBack(loop.continueTails, condition.id());

        List<Tail> exits = new ArrayList<>();
        exits.add(new Tail(condition.id(), FlowEdgeKind.FALSE_BRANCH));
        exits.addAll(loop.breakTails);
        return exits;
    }

    private List<Tail> processBreak(BreakStmt statement, List<Tail> incoming) {
        FlowNode node = addStatementNode(FlowNodeKind.STATEMENT, statement, incoming);
        // break 跳转到最内层上下文（循环或 switch）
        LoopContext target = statement.getLabel().isPresent()
                ? targetByLabel(statement.getLabel().get().asString())
                : loopContexts.peek();
        if (target == null) {
            return List.of(new Tail(node.id(), FlowEdgeKind.NEXT));
        }
        target.breakTails.add(new Tail(node.id(), FlowEdgeKind.NEXT));
        return List.of();
    }

    private List<Tail> processContinue(ContinueStmt statement, List<Tail> incoming) {
        FlowNode node = addStatementNode(FlowNodeKind.STATEMENT, statement, incoming);
        // continue 必须跳过 switch 上下文，目标为最近的外层循环
        LoopContext target = statement.getLabel().isPresent()
                ? targetByLabel(statement.getLabel().get().asString())
                : loopContexts.stream().filter(ctx -> !ctx.isSwitch).findFirst().orElse(null);
        if (target == null) {
            return List.of(new Tail(node.id(), FlowEdgeKind.NEXT));
        }
        target.continueTails.add(new Tail(node.id(), FlowEdgeKind.NEXT));
        return List.of();
    }

    private LoopContext targetByLabel(String label) {
        return loopContexts.stream()
                .filter(ctx -> label.equals(ctx.label))
                .findFirst()
                .orElse(null);
    }

    // ── switch 分支 ──────────────────────────────────────────────────────────

    private List<Tail> processSwitch(SwitchStmt statement, List<Tail> incoming) {
        FlowNode selector = addNode(FlowNodeKind.CONDITION,
                "switch (" + compact(statement.getSelector().toString()) + ")",
                absoluteLine(statement));
        connect(incoming, selector.id());
        addDataDependencies(selector, statement.getSelector());

        LoopContext switchCtx = new LoopContext(loopLabel(statement), true);
        loopContexts.push(switchCtx);

        List<Tail> fallThroughTails = List.of();
        boolean hasDefault = false;

        for (SwitchEntry entry : statement.getEntries()) {
            boolean isDefault = entry.getLabels().isEmpty();
            if (isDefault) hasDefault = true;

            List<Tail> caseIncoming = new ArrayList<>(fallThroughTails);
            if (isDefault) {
                caseIncoming.add(new Tail(selector.id(), FlowEdgeKind.FALSE_BRANCH));
            } else {
                int labelCount = entry.getLabels().size();
                for (int i = 0; i < labelCount; i++) {
                    caseIncoming.add(new Tail(selector.id(), FlowEdgeKind.CASE_BRANCH));
                }
            }

            if (entry.getStatements().isEmpty()) {
                fallThroughTails = caseIncoming;
                continue;
            }

            boolean isArrowCase = entry.getType() != SwitchEntry.Type.STATEMENT_GROUP;
            List<Tail> bodyTails = processStatements(entry.getStatements(), caseIncoming);
            if (isArrowCase) {
                // 箭头式 switch：不会 fall-through，body 退出时离开 switch
                switchCtx.breakTails.addAll(bodyTails);
                fallThroughTails = List.of();
            } else {
                fallThroughTails = bodyTails;
            }
        }

        loopContexts.pop();

        List<Tail> exits = new ArrayList<>(switchCtx.breakTails);
        exits.addAll(fallThroughTails);
        if (!hasDefault) {
            exits.add(new Tail(selector.id(), FlowEdgeKind.FALSE_BRANCH));
        }
        return exits;
    }

    // ── try/catch/finally ────────────────────────────────────────────────────

    private List<Tail> processTry(TryStmt statement, List<Tail> incoming) {
        // try-with-resources：每个资源作为 body 前的顺序 STATEMENT 节点
        List<Tail> tryIncoming = incoming;
        for (Expression resource : statement.getResources()) {
            FlowNode resourceNode = addNode(FlowNodeKind.STATEMENT,
                    compact(resource.toString()), absoluteLine(resource));
            connect(tryIncoming, resourceNode.id());
            addDataDependencies(resourceNode, resource);
            tryIncoming = List.of(new Tail(resourceNode.id(), FlowEdgeKind.NEXT));
        }

        int tryBodyStart = nodes.size();
        List<Tail> tryBodyTails = processBranch(statement.getTryBlock(), tryIncoming);
        int tryBodyEnd = nodes.size();

        // 所有可能到达 finally 的路径（正常 try 出口 + catch 出口）
        List<Tail> allExits = new ArrayList<>(tryBodyTails);

        for (CatchClause clause : statement.getCatchClauses()) {
            FlowNode catchEntry = addNode(FlowNodeKind.CATCH,
                    "catch (" + compact(clause.getParameter().toString()) + ")",
                    absoluteLine(clause));
            // 保守 EXCEPTION_BRANCH：从 try 体第一个节点出发
            if (tryBodyStart < tryBodyEnd) {
                cfgEdges.add(edge(nodes.get(tryBodyStart).id(), catchEntry.id(),
                        FlowEdgeKind.EXCEPTION_BRANCH, ""));
            }
            List<Tail> catchTails = processStatements(
                    clause.getBody().getStatements(),
                    List.of(new Tail(catchEntry.id(), FlowEdgeKind.NEXT)));
            allExits.addAll(catchTails);
        }

        if (statement.getFinallyBlock().isPresent()) {
            BlockStmt finallyBlock = statement.getFinallyBlock().get();
            FlowNode finallyEntry = addNode(FlowNodeKind.FINALLY, "finally",
                    absoluteLine(finallyBlock));
            connect(allExits, finallyEntry.id());
            return processStatements(finallyBlock.getStatements(),
                    List.of(new Tail(finallyEntry.id(), FlowEdgeKind.NEXT)));
        }

        return allExits;
    }

    private static String loopLabel(Node loop) {
        return loop.getParentNode()
                .filter(LabeledStmt.class::isInstance)
                .map(LabeledStmt.class::cast)
                .filter(labeled -> labeled.getStatement() == loop)
                .map(labeled -> labeled.getLabel().asString())
                .orElse(null);
    }

    private List<Tail> processExpressions(List<Expression> expressions, List<Tail> incoming) {
        List<Tail> tails = incoming;
        for (Expression expression : expressions) {
            FlowNode node = addNode(FlowNodeKind.STATEMENT,
                    compact(expression.toString()), absoluteLine(expression));
            connect(tails, node.id());
            addDataDependencies(node, expression);
            tails = List.of(new Tail(node.id(), FlowEdgeKind.NEXT));
        }
        return tails;
    }

    private List<Tail> processBranch(Statement statement, Tail incoming) {
        return processBranch(statement, List.of(incoming));
    }

    private List<Tail> processBranch(Statement statement, List<Tail> incoming) {
        if (statement.isBlockStmt()) {
            BlockStmt block = statement.asBlockStmt();
            if (block.isEmpty()) return incoming;
            return processStatements(block.getStatements(), incoming);
        }
        return processStatement(statement, incoming);
    }

    private void addDataDependencies(FlowNode flowNode, Node astNode) {
        Set<String> definitions = definitionsOf(astNode);
        Set<String> uses = usesOf(astNode);
        uses.removeAll(definitions);
        for (String symbol : uses) {
            String definitionNode = lastDefinitions.get(symbol);
            if (definitionNode != null && !definitionNode.equals(flowNode.id())) {
                dependencyEdges.add(edge(definitionNode, flowNode.id(),
                        FlowEdgeKind.DATA_DEPENDENCY, symbol));
            }
        }
        definitions.forEach(symbol -> lastDefinitions.put(symbol, flowNode.id()));
    }

    private void addControlDependencies(String conditionId, int firstNodeIndex) {
        addControlDependencies(conditionId, firstNodeIndex, nodes.size());
    }

    private void addControlDependencies(String conditionId, int firstNodeIndex, int endNodeIndex) {
        for (int i = firstNodeIndex; i < endNodeIndex; i++) {
            dependencyEdges.add(edge(conditionId, nodes.get(i).id(),
                    FlowEdgeKind.CONTROL_DEPENDENCY, ""));
        }
    }

    private void collectSummaryFacts() {
        for (AssignExpr assignment : body.findAll(AssignExpr.class)) {
            fieldName(assignment.getTarget()).ifPresent(fieldWrites::add);
        }
        for (UnaryExpr unary : body.findAll(UnaryExpr.class)) {
            if (unary.getOperator() == UnaryExpr.Operator.POSTFIX_INCREMENT
                    || unary.getOperator() == UnaryExpr.Operator.POSTFIX_DECREMENT
                    || unary.getOperator() == UnaryExpr.Operator.PREFIX_INCREMENT
                    || unary.getOperator() == UnaryExpr.Operator.PREFIX_DECREMENT) {
                fieldName(unary.getExpression()).ifPresent(fieldWrites::add);
            }
        }
        for (FieldAccessExpr field : body.findAll(FieldAccessExpr.class)) {
            if (isThisField(field) && !isWriteOnlyTarget(field)) {
                fieldReads.add(field.getNameAsString());
            }
        }
        for (ReturnStmt returnStmt : body.findAll(ReturnStmt.class)) {
            returnStmt.getExpression().ifPresent(expression -> {
                expression.findAll(NameExpr.class)
                        .forEach(name -> returnSources.add(name.getNameAsString()));
                expression.findAll(FieldAccessExpr.class).stream()
                        .filter(JavaFlowAnalyzer::isThisField)
                        .forEach(field -> returnSources.add(field.getNameAsString()));
            });
        }
    }

    private Set<String> definitionsOf(Node node) {
        Set<String> definitions = new LinkedHashSet<>();
        node.findAll(VariableDeclarator.class)
                .forEach(variable -> definitions.add(variable.getNameAsString()));
        node.findAll(AssignExpr.class)
                .forEach(assignment -> assignedName(assignment.getTarget()).ifPresent(definitions::add));
        node.findAll(UnaryExpr.class).stream()
                .filter(JavaFlowAnalyzer::isMutation)
                .forEach(unary -> assignedName(unary.getExpression()).ifPresent(definitions::add));
        return definitions;
    }

    private Set<String> usesOf(Node node) {
        Set<String> uses = new LinkedHashSet<>();
        node.findAll(NameExpr.class).forEach(name -> uses.add(name.getNameAsString()));
        node.findAll(FieldAccessExpr.class).stream()
                .filter(JavaFlowAnalyzer::isThisField)
                .forEach(field -> uses.add(field.getNameAsString()));
        return uses;
    }

    private Optional<String> assignedName(Expression expression) {
        if (expression.isNameExpr()) return Optional.of(expression.asNameExpr().getNameAsString());
        return fieldName(expression);
    }

    private Optional<String> fieldName(Expression expression) {
        if (expression.isFieldAccessExpr() && isThisField(expression.asFieldAccessExpr())) {
            return Optional.of(expression.asFieldAccessExpr().getNameAsString());
        }
        return Optional.empty();
    }

    private static boolean isThisField(FieldAccessExpr field) {
        return field.getScope().isThisExpr();
    }

    private static boolean isWriteOnlyTarget(FieldAccessExpr field) {
        return field.getParentNode()
                .filter(AssignExpr.class::isInstance)
                .map(AssignExpr.class::cast)
                .filter(assign -> assign.getTarget() == field)
                .map(assign -> assign.getOperator() == AssignExpr.Operator.ASSIGN)
                .orElse(false);
    }

    private static boolean isMutation(UnaryExpr unary) {
        return unary.getOperator() == UnaryExpr.Operator.POSTFIX_INCREMENT
                || unary.getOperator() == UnaryExpr.Operator.POSTFIX_DECREMENT
                || unary.getOperator() == UnaryExpr.Operator.PREFIX_INCREMENT
                || unary.getOperator() == UnaryExpr.Operator.PREFIX_DECREMENT;
    }

    private FlowNode addNode(FlowNodeKind kind, String label, int line) {
        FlowNode node = new FlowNode("f" + sequence++, kind, label, line);
        nodes.add(node);
        return node;
    }

    private FlowNode addStatementNode(FlowNodeKind kind, Statement statement, List<Tail> incoming) {
        FlowNode node = addNode(kind, compact(statement.toString()), absoluteLine(statement));
        connect(incoming, node.id());
        addDataDependencies(node, statement);
        return node;
    }

    private void connect(List<Tail> incoming, String targetId) {
        incoming.forEach(tail -> cfgEdges.add(edge(tail.id(), targetId, tail.kind(), "")));
    }

    private void connectAsLoopBack(List<Tail> incoming, String targetId) {
        incoming.forEach(tail -> cfgEdges.add(edge(
                tail.id(), targetId, FlowEdgeKind.LOOP_BACK, "")));
    }

    private int absoluteLine(Node node) {
        int localLine = node.getBegin().map(position -> position.line).orElse(1);
        return unit.startLine() + localLine - 1;
    }

    private static FlowEdge edge(String sourceId, String targetId,
                                 FlowEdgeKind kind, String symbol) {
        return new FlowEdge(sourceId, targetId, kind, symbol);
    }

    private static String compact(String source) {
        String compact = source.replaceAll("\\s+", " ").trim();
        return compact.length() <= 160 ? compact : compact.substring(0, 157) + "...";
    }

    private record Tail(String id, FlowEdgeKind kind) {}

    private static final class LoopContext {

        private final String label;
        private final boolean isSwitch;
        private final List<Tail> breakTails = new ArrayList<>();
        private final List<Tail> continueTails = new ArrayList<>();

        private LoopContext(String label, boolean isSwitch) {
            this.label = label;
            this.isSwitch = isSwitch;
        }
    }
}
