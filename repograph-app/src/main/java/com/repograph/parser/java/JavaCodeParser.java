package com.repograph.parser.java;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.parser.CodeParser;
import com.repograph.core.parser.ParseException;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import com.repograph.core.util.CodeUnitIdUtil;
import com.repograph.core.util.PathUtil;
import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.NodeList;
import com.github.javaparser.ast.body.AnnotationDeclaration;
import com.github.javaparser.ast.body.BodyDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.RecordDeclaration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import static com.repograph.parser.java.JavaParserHelpers.*;

/**
 * 基于 JavaParser AST 的精确 Java 源文件解析器。
 *
 * <p>使用 {@link JavaTypeVisitor} 遍历 AST，提取类、接口、枚举、注解类型、
 * Record、方法、构造器、字段等 {@link CodeUnit}，以及 CONTAINS、CALLS、IMPORTS 等边。
 * 解析状态通过 {@link JavaParseContext} 传递，静态辅助方法集中在 {@link JavaParserHelpers}。
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class JavaCodeParser implements CodeParser {

    private static final Logger log = LoggerFactory.getLogger(JavaCodeParser.class);

    private static final ParserConfiguration PARSER_CONFIG = new ParserConfiguration()
            .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21);

    @Override
    public boolean supports(String language) {
        return "java".equals(language);
    }

    @Override
    public ParseResult parse(Path file, ParseOptions options) throws ParseException {
        ParseOptions opts = options != null ? options : ParseOptions.defaults();
        Path projectRoot = opts.projectRoot();

        String source;
        try {
            source = Files.readString(file);
        } catch (IOException e) {
            throw new ParseException("Cannot read file: " + file, e);
        }

        CompilationUnit cu;
        try {
            com.github.javaparser.ParseResult<CompilationUnit> pr = new JavaParser(PARSER_CONFIG).parse(source);
            if (!pr.isSuccessful() || pr.getResult().isEmpty()) {
                pr.getProblems().forEach(p -> log.warn("JavaParser failed to parse {}: {}", file, p.getMessage()));
                return com.repograph.core.parser.ParseResult.empty();
            }
            cu = pr.getResult().get();
        } catch (Exception e) {
            log.warn("JavaParser failed to parse {}: {}", file, e.getMessage());
            return com.repograph.core.parser.ParseResult.empty();
        }

        String relativePath = projectRoot != null
                ? PathUtil.toRelativePath(projectRoot, file)
                : file.toString().replace('\\', '/');

        String projectId = options != null && options.projectId() != null ? options.projectId() : "";

        boolean isTestFile = isTestFile(file.getFileName().toString());

        String packageName = cu.getPackageDeclaration()
                .map(pd -> pd.getNameAsString()).orElse("");

        Map<String, String> localSymbolIds = collectLocalSymbols(cu, relativePath, projectId);

        JavaParseContext ctx = new JavaParseContext(
                source, relativePath, projectId, projectRoot, isTestFile, localSymbolIds
        );
        ctx.packageName = packageName;
        ctx.initImports(cu);
        cu.accept(new JavaTypeVisitor(), ctx);
        ctx.processImportEdges(cu);

        return ParseResult.of(
                Collections.unmodifiableList(ctx.units),
                Collections.unmodifiableList(ctx.edges),
                "JavaCodeParser"
        );
    }

    // ── First-pass symbol collector ───────────────────────────────────────────

    private Map<String, String> collectLocalSymbols(CompilationUnit cu, String relativePath, String projectId) {
        Map<String, String> symbols = new LinkedHashMap<>();
        String packageName = cu.getPackageDeclaration().map(p -> p.getNameAsString()).orElse("");

        cu.findAll(ClassOrInterfaceDeclaration.class).forEach(c -> {
            String fqn = buildTypeFqn(packageName, c);
            symbols.put(fqn, CodeUnitIdUtil.computeId(projectId, relativePath, c.isInterface() ? CodeUnitKind.INTERFACE : CodeUnitKind.CLASS, fqn));
            collectMemberSymbols(c.getMembers(), fqn, relativePath, projectId, symbols);
        });
        cu.findAll(EnumDeclaration.class).forEach(e -> {
            String fqn = buildTypeFqnEnum(packageName, e);
            symbols.put(fqn, CodeUnitIdUtil.computeId(projectId, relativePath, CodeUnitKind.ENUM, fqn));
        });
        cu.findAll(RecordDeclaration.class).forEach(r -> {
            String fqn = buildTypeFqnRecord(packageName, r);
            symbols.put(fqn, CodeUnitIdUtil.computeId(projectId, relativePath, CodeUnitKind.CLASS, fqn));
        });
        cu.findAll(AnnotationDeclaration.class).forEach(a -> {
            String fqn = buildTypeFqnAnnotation(packageName, a);
            symbols.put(fqn, CodeUnitIdUtil.computeId(projectId, relativePath, CodeUnitKind.ANNOTATION, fqn));
        });
        return symbols;
    }

    private void collectMemberSymbols(NodeList<BodyDeclaration<?>> members, String classFqn,
                                       String relativePath, String projectId, Map<String, String> symbols) {
        for (BodyDeclaration<?> member : members) {
            if (member instanceof MethodDeclaration m) {
                String qn = buildMethodQn(classFqn, m);
                symbols.put(qn, CodeUnitIdUtil.computeId(projectId, relativePath, CodeUnitKind.METHOD, qn));
            } else if (member instanceof ConstructorDeclaration ctor) {
                String qn = buildConstructorQn(classFqn, ctor);
                symbols.put(qn, CodeUnitIdUtil.computeId(projectId, relativePath, CodeUnitKind.CONSTRUCTOR, qn));
            }
        }
    }
}
