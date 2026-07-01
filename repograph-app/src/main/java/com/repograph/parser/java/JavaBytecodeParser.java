package com.repograph.parser.java;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.model.EdgeKind;
import com.repograph.core.model.RelationEdge;
import com.repograph.core.parser.CodeParser;
import com.repograph.core.parser.ParseException;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import com.repograph.core.util.CodeUnitIdUtil;
import com.repograph.core.util.PathUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import sootup.core.jimple.common.expr.AbstractInvokeExpr;
import sootup.core.jimple.common.stmt.Stmt;
import sootup.core.model.Body;
import sootup.core.model.MethodModifier;
import sootup.core.model.SootField;
import sootup.core.model.SootMethod;
import sootup.core.signatures.MethodSignature;
import sootup.core.types.ClassType;
import sootup.core.types.Type;
import sootup.java.bytecode.inputlocation.JavaClassPathAnalysisInputLocation;
import sootup.java.core.JavaSootClass;
import sootup.java.core.views.JavaView;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

import static com.repograph.parser.java.JavaBytecodeUtils.*;

/**
 * 基于 SootUp 1.3.0 的 Java 字节码解析器，提供编译级别的代码分割能力。
 *
 * <p>与 {@link JavaCodeParser}（源码 AST 级别）的差异：
 * <ul>
 *   <li>直接分析 {@code .class} 文件，无需源码即可索引编译产物或第三方 JAR</li>
 *   <li>CALLS 边来自字节码 invoke 指令（invokevirtual / invokespecial / invokestatic /
 *       invokeinterface），精度高于 AST 推断</li>
 *   <li>Lambda 表达式被编译为独立 synthetic 方法（{@code lambda$method$0}），作为独立 CodeUnit 提取</li>
 *   <li>匿名内部类（{@code Outer$1.class}）跳过，由其外部类的 .java 文件统一覆盖</li>
 * </ul>
 *
 * <p><b>触发方式</b>：将 {@code "class"} 加入 {@code IndexOptions.languages}，SourceFileScanner
 * 会同时扫描 {@code .class} 文件，ParserDispatcher 将其路由到本解析器。
 * 默认不开启，不影响现有的纯源码索引流程。
 *
 * <p><b>视图缓存</b>：{@link JavaView} 按类根目录（{@code ConcurrentHashMap}）缓存，
 * 同一目录下多个 {@code .class} 文件共用同一视图，避免重复加载 classpath 带来的性能损耗。
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class JavaBytecodeParser implements CodeParser {

    private static final Logger log = LoggerFactory.getLogger(JavaBytecodeParser.class);

    /** 常见 Gradle / Maven 编译输出目录，按优先级排列。 */
    private static final List<String> CLASS_ROOT_CANDIDATES = List.of(
            "build/classes/java/main",
            "build/classes/java/test",
            "build/classes/kotlin/main",
            "target/classes",
            "target/test-classes",
            "out/production/classes",
            "out/test/classes"
    );

    /**
     * SootUp JavaView 按类根目录缓存。
     * View 创建代价较高（扫描目录、建类索引），复用同一 View 是必要的性能优化。
     */
    private final Map<Path, JavaView> viewCache = new ConcurrentHashMap<>();

    @Override
    public boolean supports(String language) {
        return "class".equals(language);
    }

    @Override
    public ParseResult parse(Path classFile, ParseOptions options) throws ParseException {
        ParseOptions opts = options != null ? options : ParseOptions.defaults();
        Path projectRoot = opts.projectRoot();
        String projectId = opts.projectId() != null ? opts.projectId() : "";

        Path classRoot = findClassRoot(classFile, projectRoot);
        String fqn = classFileToFqn(classFile, classRoot);
        if (fqn == null) {
            log.debug("Cannot derive FQN for {}, skipping", classFile);
            return ParseResult.empty();
        }

        // 匿名类（Outer$1）跳过；它们的代码已包含在外部类的源码范围内
        if (isAnonymousClass(fqn)) {
            log.debug("Skipping anonymous class: {}", fqn);
            return ParseResult.empty();
        }

        String relativePath = projectRoot != null
                ? PathUtil.toRelativePath(projectRoot, classFile)
                : classFile.toString().replace('\\', '/');

        try {
            JavaView view = viewCache.computeIfAbsent(classRoot, this::buildView);
            Optional<JavaSootClass> sootClassOpt = lookupClass(view, fqn);

            if (sootClassOpt.isEmpty()) {
                log.debug("Class {} not found in SootUp view (root: {})", fqn, classRoot);
                return ParseResult.empty();
            }

            return extractFrom(sootClassOpt.get(), fqn, relativePath, projectId, projectRoot);
        } catch (ParseException pe) {
            throw pe;
        } catch (Exception e) {
            throw new ParseException("Bytecode analysis failed for " + classFile + ": " + e.getMessage(), e);
        }
    }

    // ── SootUp view 构建 ──────────────────────────────────────────────────────

    private JavaView buildView(Path classRoot) {
        log.debug("Building SootUp JavaView for class root: {}", classRoot);
        // JavaView(AnalysisInputLocation) — SootUp 1.3.0 直接构造，无需 JavaProject
        JavaClassPathAnalysisInputLocation loc =
                new JavaClassPathAnalysisInputLocation(classRoot.toString());
        return new JavaView(loc);
    }

    private Optional<JavaSootClass> lookupClass(JavaView view, String fqn) {
        try {
            ClassType classType = view.getIdentifierFactory().getClassType(fqn);
            return view.getClass(classType);
        } catch (Throwable t) {
            log.debug("SootUp lookup failed for {}: {}", fqn, t.getMessage());
            return Optional.empty();
        }
    }

    // ── 主提取逻辑 ────────────────────────────────────────────────────────────

    private ParseResult extractFrom(JavaSootClass sootClass, String classFqn,
                                    String relativePath, String projectId, Path projectRoot) {
        List<CodeUnit> units = new ArrayList<>();
        List<RelationEdge> edges = new ArrayList<>();

        // ── 类单元 ──
        CodeUnitKind classKind = resolveClassKind(sootClass);
        Map<String, String> classMeta = new LinkedHashMap<>();
        classMeta.put("visibility", classVisibility(sootClass));
        if (sootClass.isAbstract() && !sootClass.isInterface()) classMeta.put("is_abstract", "true");
        if (sootClass.isFinal()) classMeta.put("is_final", "true");
        classMeta.put("bytecode", "true");

        String simpleName = simpleNameOf(classFqn);
        String classId = CodeUnitIdUtil.computeId(projectId, relativePath, classKind, classFqn);
        String classSig = buildClassSig(sootClass, simpleName);

        // 内部类：外部类的 FQN（$ 分隔）
        String parentFqn = classFqn.contains("$")
                ? classFqn.substring(0, classFqn.lastIndexOf('$'))
                : null;

        // 优先从 .java 源文件提取整体原始代码（rawSource 用于语义 Embedding）
        String rawSource = tryFetchSource(classFqn, projectRoot, 0, 0);

        units.add(new CodeUnit(classId, classKind, "java", classFqn, simpleName,
                relativePath, 0, 0,
                rawSource != null ? rawSource : classSig,
                classSig, List.of(), parentFqn, classMeta));

        // EXTENDS 边
        sootClass.getSuperclass().ifPresent(superType -> {
            String superFqn = superType.getFullyQualifiedName();
            if (!"java.lang.Object".equals(superFqn)) {
                edges.add(new RelationEdge(classId, superFqn, EdgeKind.EXTENDS, false, relativePath, 0));
            }
        });

        // IMPLEMENTS 边
        for (ClassType iface : sootClass.getInterfaces()) {
            edges.add(new RelationEdge(classId, iface.getFullyQualifiedName(),
                    EdgeKind.IMPLEMENTS, false, relativePath, 0));
        }

        // ── 字段 ──
        for (SootField field : sootClass.getFields()) {
            extractField(field, classId, classFqn, relativePath, projectId, units, edges);
        }

        // ── 方法（含 lambda$ synthetic 方法） ──
        for (SootMethod method : sootClass.getMethods()) {
            extractMethod(method, classId, classFqn, relativePath, projectId, projectRoot, units, edges);
        }

        return ParseResult.of(
                Collections.unmodifiableList(units),
                Collections.unmodifiableList(edges),
                "JavaBytecodeParser"
        );
    }

    // ── 字段提取 ──────────────────────────────────────────────────────────────

    private void extractField(SootField field, String classId, String classFqn,
                              String relativePath, String projectId,
                              List<CodeUnit> units, List<RelationEdge> edges) {
        String fieldQn = classFqn + "." + field.getName();
        String fieldId = CodeUnitIdUtil.computeId(projectId, relativePath, CodeUnitKind.FIELD, fieldQn);

        Map<String, String> meta = new LinkedHashMap<>();
        meta.put("visibility", fieldVisibility(field));
        if (field.isStatic()) meta.put("is_static", "true");
        if (field.isFinal()) meta.put("is_final", "true");
        meta.put("bytecode", "true");

        String sig = fieldSig(field);
        units.add(new CodeUnit(fieldId, CodeUnitKind.FIELD, "java", fieldQn, field.getName(),
                relativePath, 0, 0, sig, sig, List.of(), classFqn, meta));
        edges.add(new RelationEdge(classId, fieldId, EdgeKind.CONTAINS, true, relativePath, 0));
    }

    // ── 方法提取 ──────────────────────────────────────────────────────────────

    private void extractMethod(SootMethod method, String classId, String classFqn,
                               String relativePath, String projectId, Path projectRoot,
                               List<CodeUnit> units, List<RelationEdge> edges) {
        String rawName = method.getName();

        // 静态初始化块不作为可搜索单元
        if ("<clinit>".equals(rawName)) return;

        String paramTypes = method.getParameterTypes().stream()
                .map(Type::toString)
                .collect(Collectors.joining(","));

        CodeUnitKind unitKind;
        String displayName;
        String methodQn;

        if ("<init>".equals(rawName)) {
            unitKind = CodeUnitKind.CONSTRUCTOR;
            displayName = simpleNameOf(classFqn);
            methodQn = classFqn + "#" + displayName + "(" + paramTypes + ")";
        } else {
            unitKind = CodeUnitKind.METHOD;
            displayName = rawName;
            methodQn = classFqn + "#" + rawName + "(" + paramTypes + ")";
        }

        String methodId = CodeUnitIdUtil.computeId(projectId, relativePath, unitKind, methodQn);

        Map<String, String> meta = new LinkedHashMap<>();
        meta.put("visibility", methodVisibility(method));
        if (method.isStatic()) meta.put("is_static", "true");
        if (method.isAbstract()) meta.put("is_abstract", "true");
        if (method.isFinal()) meta.put("is_final", "true");
        meta.put("return_type", method.getReturnType().toString());
        if (!paramTypes.isEmpty()) meta.put("param_types", paramTypes);
        // synthetic 覆盖 lambda$、bridge$ 等编译生成方法
        if (method.getModifiers().contains(MethodModifier.SYNTHETIC)) meta.put("is_synthetic", "true");
        if (method.getModifiers().contains(MethodModifier.BRIDGE)) meta.put("is_bridge", "true");
        meta.put("bytecode", "true");

        String sig = methodSig(method, displayName);
        int startLine = 0;
        int endLine = 0;
        String rawSource = null;

        // 从字节码行号表提取行范围，再从 .java 文件回填原始源码
        if (method.hasBody()) {
            try {
                Body body = method.getBody();   // SootUp 1.3.0: getBody() 直接返回 Body
                int[] range = lineRangeOf(body);
                startLine = range[0];
                endLine = range[1];
                if (startLine > 0 && projectRoot != null) {
                    rawSource = tryFetchSource(classFqn, projectRoot, startLine, endLine);
                }
                extractCallEdges(body, methodId, relativePath, edges);
            } catch (Exception e) {
                log.debug("Body analysis failed for {}: {}", methodQn, e.getMessage());
            }
        }

        units.add(new CodeUnit(methodId, unitKind, "java", methodQn, displayName,
                relativePath, startLine, endLine,
                rawSource != null ? rawSource : sig,
                sig, List.of(), classFqn, meta));
        edges.add(new RelationEdge(classId, methodId, EdgeKind.CONTAINS, true, relativePath, startLine));
    }

    // ── CALLS 边（字节码 invoke 指令） ────────────────────────────────────────

    /**
     * 遍历方法体 Jimple 语句，将每条 invoke 指令转换为 CALLS 边。
     *
     * <p>相比 AST 级别推断的优势：
     * <ul>
     *   <li>接收者类型已经过类型擦除，与运行时一致</li>
     *   <li>能正确区分 INVOKEVIRTUAL / INVOKESPECIAL / INVOKESTATIC / INVOKEINTERFACE</li>
     *   <li>Lambda 等合成调用（INVOKEDYNAMIC 展开后的 lambda$ 调用）也会出现在边集合中</li>
     * </ul>
     */
    private void extractCallEdges(Body body, String callerId, String relativePath,
                                  List<RelationEdge> edges) {
        for (Stmt stmt : body.getStmts()) {
            if (!stmt.containsInvokeExpr()) continue;
            try {
                AbstractInvokeExpr invokeExpr = stmt.getInvokeExpr();
                MethodSignature target = invokeExpr.getMethodSignature();
                String targetParams = target.getParameterTypes().stream()
                        .map(Type::toString)
                        .collect(Collectors.joining(","));
                String targetQn = target.getDeclClassType().getFullyQualifiedName()
                        + "#" + target.getName()
                        + "(" + targetParams + ")";
                int line = stmtLine(stmt);
                edges.add(new RelationEdge(callerId, targetQn, EdgeKind.CALLS, false, relativePath, line));
            } catch (Exception e) {
                log.trace("Skipping invoke stmt in {}: {}", callerId, e.getMessage());
            }
        }
    }

    // ── 类根目录查找 ──────────────────────────────────────────────────────────

    /**
     * 从 {@code .class} 文件路径推断类根目录（包层次起点）。
     *
     * <p>查找顺序：
     * <ol>
     *   <li>在 projectRoot 下尝试标准 Gradle/Maven 输出目录</li>
     *   <li>在 projectRoot 的直接子目录（子模块）下重复尝试（多模块项目）</li>
     *   <li>退化为基于 Java 包名约定的启发式向上查找</li>
     * </ol>
     */
    private Path findClassRoot(Path classFile, Path projectRoot) {
        if (projectRoot != null) {
            // 单模块
            for (String candidate : CLASS_ROOT_CANDIDATES) {
                Path root = projectRoot.resolve(candidate);
                if (classFile.startsWith(root)) return root;
            }
            // 多模块：遍历 projectRoot 直接子目录
            try {
                List<Path> subdirs = Files.list(projectRoot)
                        .filter(Files::isDirectory)
                        .collect(Collectors.toList());
                for (Path subdir : subdirs) {
                    for (String candidate : CLASS_ROOT_CANDIDATES) {
                        Path root = subdir.resolve(candidate);
                        if (classFile.startsWith(root)) return root;
                    }
                }
            } catch (IOException ignored) {
            }
        }
        return findClassRootHeuristic(classFile);
    }

    /**
     * 向上遍历目录树，找到第一个不符合 Java 包命名约定的目录（视为类根）。
     */
    private Path findClassRootHeuristic(Path classFile) {
        Path dir = classFile.getParent();
        while (dir != null && dir.getFileName() != null) {
            String name = dir.getFileName().toString();
            // Java 包目录通常全小写，不符合则视为类根
            if (!name.matches("[a-z][a-zA-Z0-9_]*")) {
                return dir;
            }
            dir = dir.getParent();
        }
        return classFile.getParent() != null ? classFile.getParent() : classFile;
    }

    // ── 源码回填 ──────────────────────────────────────────────────────────────

    /**
     * 在项目常见源码目录中查找与 {@code classFqn} 对应的 {@code .java} 文件，
     * 返回 [startLine, endLine] 范围内的源码文本；startLine=0 时返回整个文件。
     */
    private String tryFetchSource(String classFqn, Path projectRoot, int startLine, int endLine) {
        if (projectRoot == null) return null;

        // 内部类统一指向外部类的 .java 文件
        String outerFqn = classFqn.contains("$") ? classFqn.substring(0, classFqn.indexOf('$')) : classFqn;
        String sourcePath = outerFqn.replace('.', '/') + ".java";

        List<Path> candidates = new ArrayList<>();
        for (String srcDir : List.of("src/main/java", "src/test/java", "src/main/kotlin", "src")) {
            candidates.add(projectRoot.resolve(srcDir).resolve(sourcePath));
        }
        // 多模块子目录
        try {
            Files.list(projectRoot).filter(Files::isDirectory).forEach(module -> {
                for (String srcDir : List.of("src/main/java", "src/test/java")) {
                    candidates.add(module.resolve(srcDir).resolve(sourcePath));
                }
            });
        } catch (IOException ignored) {
        }

        for (Path candidate : candidates) {
            if (!Files.exists(candidate)) continue;
            try {
                String source = Files.readString(candidate);
                if (startLine > 0 && endLine > 0) {
                    return sliceLines(source, startLine, endLine);
                }
                return source;
            } catch (IOException e) {
                log.debug("Cannot read source {}: {}", candidate, e.getMessage());
            }
        }
        return null;
    }

    private static String sliceLines(String source, int startLine, int endLine) {
        String[] lines = source.split("\n", -1);
        int from = Math.max(0, startLine - 1);
        int to = Math.min(lines.length, endLine);
        if (from >= to) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = from; i < to; i++) {
            if (i > from) sb.append('\n');
            sb.append(lines[i]);
        }
        return sb.toString();
    }

}
