package com.repograph.flow;

import com.repograph.core.flow.FlowAnalysisResult;
import com.repograph.core.flow.FlowAnalysisService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.treesitter.TSNode;
import org.treesitter.TSParser;
import org.treesitter.TSTree;
import org.treesitter.TreeSitterC;
import org.treesitter.TreeSitterPython;

import java.nio.charset.StandardCharsets;
import java.util.Optional;

/**
 * C / Python 関数の CFG + 保守的 DataFlowSummary 分析サービス。
 *
 * <p>Tree-sitter で rawSource を再パースし、{@link CFlowAnalyzer} または
 * {@link PythonFlowAnalyzer} に委譲する。PDG は生成せず {@code precise=false} で返す。
 *
 * <p>Tree-sitter native ライブラリがロードできない場合は {@code Optional.empty()} を返す。
 *
 * @author leolu
 */
@Service
public class TreeSitterFlowAnalysisService implements FlowAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(TreeSitterFlowAnalysisService.class);

    private static final boolean C_AVAILABLE;
    private static final boolean PYTHON_AVAILABLE;

    static {
        boolean c = false;
        try { new TreeSitterC(); c = true; } catch (Throwable ignored) {}
        C_AVAILABLE = c;

        boolean py = false;
        try { new TreeSitterPython(); py = true; } catch (Throwable ignored) {}
        PYTHON_AVAILABLE = py;
    }

    @Override
    public Optional<FlowAnalysisResult> analyze(CodeUnit unit) {
        if (unit == null || unit.rawSource() == null || unit.rawSource().isBlank()) {
            return Optional.empty();
        }
        return switch (unit.language()) {
            case "c" -> analyzeC(unit);
            case "python" -> analyzePython(unit);
            default -> Optional.empty();
        };
    }

    // ── C ─────────────────────────────────────────────────────────────────────

    private Optional<FlowAnalysisResult> analyzeC(CodeUnit unit) {
        if (!C_AVAILABLE || unit.kind() != CodeUnitKind.FUNCTION) return Optional.empty();
        try {
            TSParser parser = new TSParser();
            parser.setLanguage(new TreeSitterC());
            byte[] bytes = unit.rawSource().getBytes(StandardCharsets.UTF_8);
            TSTree tree = parser.parseString(null, unit.rawSource());
            if (tree == null) return Optional.empty();
            TSNode body = findFunctionBody(tree.getRootNode(), "function_definition");
            if (body == null) return Optional.empty();
            return Optional.of(new CFlowAnalyzer(unit, body, bytes).analyze());
        } catch (RuntimeException e) {
            log.warn("C flow analysis failed for '{}': {}", unit.qualifiedName(), e.getMessage());
            return Optional.empty();
        }
    }

    // ── Python ────────────────────────────────────────────────────────────────

    private Optional<FlowAnalysisResult> analyzePython(CodeUnit unit) {
        if (!PYTHON_AVAILABLE
                || (unit.kind() != CodeUnitKind.METHOD && unit.kind() != CodeUnitKind.FUNCTION)) {
            return Optional.empty();
        }
        try {
            TSParser parser = new TSParser();
            parser.setLanguage(new TreeSitterPython());
            byte[] bytes = unit.rawSource().getBytes(StandardCharsets.UTF_8);
            TSTree tree = parser.parseString(null, unit.rawSource());
            if (tree == null) return Optional.empty();
            TSNode body = findFunctionBody(tree.getRootNode(),
                    "function_definition", "async_function_definition");
            if (body == null) return Optional.empty();
            return Optional.of(new PythonFlowAnalyzer(unit, body, bytes).analyze());
        } catch (RuntimeException e) {
            log.warn("Python flow analysis failed for '{}': {}", unit.qualifiedName(), e.getMessage());
            return Optional.empty();
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Finds the {@code body} field of the first matching function node in the root's children.
     * For C the body is a {@code compound_statement}; for Python it is a {@code block}.
     */
    private static TSNode findFunctionBody(TSNode root, String... nodeTypes) {
        int count = root.getChildCount();
        for (int i = 0; i < count; i++) {
            TSNode child = root.getChild(i);
            if (child.isNull()) continue;
            for (String type : nodeTypes) {
                if (type.equals(child.getType())) {
                    TSNode body = child.getChildByFieldName("body");
                    if (body != null && !body.isNull()) return body;
                }
            }
        }
        return null;
    }
}
