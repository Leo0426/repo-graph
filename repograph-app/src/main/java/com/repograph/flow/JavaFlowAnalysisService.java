package com.repograph.flow;

import com.repograph.core.flow.FlowAnalysisResult;
import com.repograph.core.flow.FlowAnalysisService;
import com.repograph.core.flow.MethodTaintSummary;
import com.repograph.core.flow.TaintSummaryService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.body.BodyDeclaration;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.stmt.BlockStmt;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Optional;

/**
 * 基于 JavaParser 的按需方法级数据流、控制流与轻量 PDG 分析。
 *
 * <p>分析结果只在请求期间存在，不会将语句节点持久化为 {@code CodeUnit}。
 * 具体分析逻辑分别委托给 {@link JavaFlowAnalyzer}（CFG/PDG）
 * 和 {@link JavaFlowTaintSummarizer}（污点摘要）。
 *
 * @author leolu
 */
@Service
public class JavaFlowAnalysisService implements FlowAnalysisService, TaintSummaryService {

    private static final Logger log = LoggerFactory.getLogger(JavaFlowAnalysisService.class);

    @Override
    public Optional<FlowAnalysisResult> analyze(CodeUnit unit) {
        if (unit == null || !"java".equals(unit.language())
                || (unit.kind() != CodeUnitKind.METHOD && unit.kind() != CodeUnitKind.CONSTRUCTOR)
                || unit.rawSource() == null || unit.rawSource().isBlank()) {
            return Optional.empty();
        }
        try {
            JavaParser parser = new JavaParser(new ParserConfiguration()
                    .setLanguageLevel(ParserConfiguration.LanguageLevel.BLEEDING_EDGE));
            BodyDeclaration<?> declaration = parser.parseBodyDeclaration(unit.rawSource())
                    .getResult()
                    .orElseThrow(() -> new IllegalArgumentException("Unable to parse body declaration"));
            if (!(declaration instanceof CallableDeclaration<?> callable)) return Optional.empty();
            BlockStmt body = bodyOf(callable);
            if (body == null) return Optional.empty();
            return Optional.of(new JavaFlowAnalyzer(unit, callable, body).analyze());
        } catch (RuntimeException e) {
            log.warn("Flow analysis failed for '{}': {}", unit.qualifiedName(), e.getMessage());
            return Optional.empty();
        }
    }

    @Override
    public Optional<MethodTaintSummary> summarize(CodeUnit unit) {
        if (unit == null || !"java".equals(unit.language())
                || (unit.kind() != CodeUnitKind.METHOD && unit.kind() != CodeUnitKind.CONSTRUCTOR)
                || unit.rawSource() == null || unit.rawSource().isBlank()) {
            return Optional.empty();
        }
        try {
            JavaParser parser = new JavaParser(new ParserConfiguration()
                    .setLanguageLevel(ParserConfiguration.LanguageLevel.BLEEDING_EDGE));
            BodyDeclaration<?> declaration = parser.parseBodyDeclaration(unit.rawSource())
                    .getResult()
                    .orElse(null);
            if (!(declaration instanceof CallableDeclaration<?> callable)) return Optional.empty();
            BlockStmt body = bodyOf(callable);
            if (body == null) return Optional.empty();
            return Optional.of(new JavaFlowTaintSummarizer(unit.qualifiedName(), callable, body).compute());
        } catch (RuntimeException e) {
            log.warn("Taint summary failed for '{}': {}", unit.qualifiedName(), e.getMessage());
            return Optional.empty();
        }
    }

    private static BlockStmt bodyOf(CallableDeclaration<?> callable) {
        if (callable instanceof MethodDeclaration method) {
            return method.getBody().orElse(null);
        }
        if (callable instanceof ConstructorDeclaration constructor) {
            return constructor.getBody();
        }
        return null;
    }
}
