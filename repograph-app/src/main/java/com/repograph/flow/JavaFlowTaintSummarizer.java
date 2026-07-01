package com.repograph.flow;

import com.repograph.core.flow.MethodTaintSummary;
import com.repograph.core.flow.TaintEdge;
import com.repograph.core.flow.TaintSlot;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.expr.AssignExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.CatchClause;
import com.github.javaparser.ast.stmt.TryStmt;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Flow-insensitive 方法内污点传播：计算每个参数能污染哪些调用位置参数和返回值。
 *
 * <p>算法：固定点迭代赋值语句，收敛后扫描 return 语句和调用表达式提取边。
 * 忽略控制流顺序（保守近似），确保不漏报。
 */
final class JavaFlowTaintSummarizer {

    /** 已知危险 Sink 的简单方法名。 */
    private static final Set<String> SINK_NAMES = Set.of(
            // SQL 执行
            "executeQuery", "executeUpdate", "execute", "executeBatch", "executeLargeUpdate",
            // 进程 / 操作系统命令
            "exec", "start",
            // 反序列化
            "readObject", "readUnshared", "deserialize",
            // 类加载
            "loadClass", "forName",
            // HTTP 响应输出
            "write", "print", "println", "sendRedirect", "sendError",
            // 反射 / 动态调用
            "invoke", "newInstance",
            // JNDI 查找
            "lookup",
            // LDAP / XML 解析
            "search", "parse");

    private final String methodQn;
    private final CallableDeclaration<?> callable;
    private final BlockStmt body;
    /** 变量名 → 能到达该变量的参数下标集合。 */
    private final Map<String, Set<Integer>> tainted = new HashMap<>();

    JavaFlowTaintSummarizer(String methodQn, CallableDeclaration<?> callable, BlockStmt body) {
        this.methodQn = methodQn;
        this.callable = callable;
        this.body = body;
    }

    MethodTaintSummary compute() {
        List<String> params = callable.getParameters().stream()
                .map(p -> p.getNameAsString())
                .toList();
        // 初始化：每个参数被自身污染
        for (int i = 0; i < params.size(); i++) {
            tainted.computeIfAbsent(params.get(i), k -> new HashSet<>()).add(i);
        }
        propagate();

        List<TaintEdge> edges = new ArrayList<>();
        extractReturnEdges(edges);
        extractCallSiteEdges(edges);

        return new MethodTaintSummary(methodQn, params, List.copyOf(edges));
    }

    /** 固定点传播：赋值/声明将右侧污点传递给左侧变量；try 体中出现的污染变量保守传入 catch 参数。 */
    private void propagate() {
        boolean changed = true;
        while (changed) {
            changed = false;
            for (VariableDeclarator decl : body.findAll(VariableDeclarator.class)) {
                if (decl.getInitializer().isPresent()) {
                    changed |= mergeInto(decl.getNameAsString(), sources(decl.getInitializer().get()));
                }
            }
            for (AssignExpr assign : body.findAll(AssignExpr.class)) {
                if (assign.getTarget().isNameExpr()) {
                    changed |= mergeInto(assign.getTarget().asNameExpr().getNameAsString(),
                            sources(assign.getValue()));
                }
            }
            // 保守异常传播：若 try 体中出现任意污染变量，对应 catch 参数也可能携带该污点（如 e.getMessage()）。
            for (TryStmt tryStmt : body.findAll(TryStmt.class)) {
                Set<Integer> exceptionSources = new HashSet<>();
                for (NameExpr nameExpr : tryStmt.getTryBlock().findAll(NameExpr.class)) {
                    Set<Integer> t = tainted.get(nameExpr.getNameAsString());
                    if (t != null) exceptionSources.addAll(t);
                }
                if (!exceptionSources.isEmpty()) {
                    for (CatchClause cc : tryStmt.getCatchClauses()) {
                        changed |= mergeInto(cc.getParameter().getNameAsString(), exceptionSources);
                    }
                }
            }
        }
    }

    /** 扫描 return 语句，提取 param[i] → return 边。 */
    private void extractReturnEdges(List<TaintEdge> edges) {
        for (var ret : body.findAll(com.github.javaparser.ast.stmt.ReturnStmt.class)) {
            ret.getExpression().ifPresent(expr ->
                    sources(expr).forEach(i ->
                            edges.add(new TaintEdge(TaintSlot.param(i), TaintSlot.ofReturn()))));
        }
    }

    /** 扫描方法调用表达式，提取 param[i] → callee.arg[j] 或 param[i] → sink 边。 */
    private void extractCallSiteEdges(List<TaintEdge> edges) {
        for (MethodCallExpr call : body.findAll(MethodCallExpr.class)) {
            String name = call.getNameAsString();
            boolean isSink = SINK_NAMES.contains(name);
            for (int j = 0; j < call.getArguments().size(); j++) {
                Set<Integer> srcs = sources(call.getArgument(j));
                for (int i : srcs) {
                    TaintSlot from = TaintSlot.param(i);
                    TaintSlot to = isSink
                            ? TaintSlot.sink(name, j)
                            : TaintSlot.callArg(name, j);
                    edges.add(new TaintEdge(from, to));
                }
            }
        }
    }

    /** 返回表达式中所有名称对应的污点源参数下标。 */
    private Set<Integer> sources(Expression expr) {
        Set<Integer> result = new HashSet<>();
        for (NameExpr name : expr.findAll(NameExpr.class)) {
            Set<Integer> t = tainted.get(name.getNameAsString());
            if (t != null) result.addAll(t);
        }
        return result;
    }

    private boolean mergeInto(String var, Set<Integer> incoming) {
        if (incoming.isEmpty()) return false;
        return tainted.computeIfAbsent(var, k -> new HashSet<>()).addAll(incoming);
    }
}
