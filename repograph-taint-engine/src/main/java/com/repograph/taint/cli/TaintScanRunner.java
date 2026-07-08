package com.repograph.taint.cli;

import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.core.util.config.AnalysisScopeReader;
import com.ibm.wala.ipa.callgraph.AnalysisCacheImpl;
import com.ibm.wala.ipa.callgraph.AnalysisOptions;
import com.ibm.wala.ipa.callgraph.AnalysisScope;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.CallGraphBuilder;
import com.ibm.wala.ipa.callgraph.Entrypoint;
import com.ibm.wala.ipa.callgraph.impl.DefaultEntrypoint;
import com.ibm.wala.ipa.callgraph.impl.Util;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ipa.cha.ClassHierarchy;
import com.ibm.wala.ipa.cha.ClassHierarchyFactory;
import com.ibm.wala.classLoader.Language;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.util.NullProgressMonitor;
import com.repograph.taint.TaintAnalysisConfig;
import com.repograph.taint.api.CheckConfig;
import com.repograph.taint.api.DefaultContext;
import com.repograph.taint.api.IContext;
import com.repograph.taint.api.cache.GlobalCache;
import com.repograph.taint.api.report.taint.Flow;
import com.repograph.taint.api.report.taint.TaintResult;
import com.repograph.taint.api.rules.IRule;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.TaintDomain;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.solver.ITaintSolver;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.solver.TaintSolver;
import com.repograph.taint.sourcesink.ISourceSinkDefinitionProvider;
import com.repograph.taint.sourcesink.SourceSinkJSONProvider;

import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 可复用的精确污点分析管道(WALA + IFDS),供 {@link TaintScanCli} 独立进程与测试共用。
 * <p>
 * 与 repograph-app 解耦:输入编译后的 classpath + source/sink JSON,输出 {@link TaintFlowDto} 列表。
 * <p>
 * 运行要求(见 CONTEXT.md):必须运行在带 jmods 的 JDK(WALA 建 JRE primordial 模型);
 * 建议传入排除文件剪掉 JRE 昂贵闭包,否则访问路径预分析会在全 java.base 超图上卡死。
 */
public final class TaintScanRunner {

    private TaintScanRunner() {}

    /**
     * 在给定 classpath 上运行精确污点分析。
     *
     * @param classpath      WALA 分析 classpath(编译后的 classes 目录或 jar,支持 {@code File.pathSeparator} 分隔多个)
     * @param exclusionsFile WALA 排除文件;{@code null} 时使用打包在 classpath 的默认 {@code JavaTaintExclusions.txt}
     * @param sasJson        source/sink 配置 JSON 文本(schema 同 SourceSinkJSONProvider)
     * @param ruleName       规则名(写入结果,如 "CWE_78")
     * @return 发现的污点流列表
     */
    public static List<TaintFlowDto> run(String classpath, File exclusionsFile,
                                         String sasJson, String ruleName) throws Exception {
        return run(classpath, exclusionsFile, sasJson, ruleName, null);
    }

    /**
     * @param entryMethodNames 仅将这些方法名作为入口点;{@code null}/空则用应用类的全部 public 方法
     *                         (真实扫描的默认策略)。指定入口可缩小分析范围、聚焦目标。
     */
    public static List<TaintFlowDto> run(String classpath, File exclusionsFile,
                                         String sasJson, String ruleName,
                                         Set<String> entryMethodNames) throws Exception {
        installContext(ruleName);

        File exclusions = exclusionsFile != null ? exclusionsFile : defaultExclusionsFile();
        AnalysisScope scope = AnalysisScopeReader.instance.makeJavaBinaryAnalysisScope(classpath, exclusions);
        ClassHierarchy cha = ClassHierarchyFactory.makeWithRoot(scope);

        // 入口点:默认取应用类全部 public 非构造/clinit 方法(贴近真实扫描的入口集合)。
        // 指定 entryMethodNames 时按方法名过滤,聚焦目标(测试用)。
        boolean filterByName = entryMethodNames != null && !entryMethodNames.isEmpty();
        Set<Entrypoint> entries = new HashSet<>();
        cha.getLoader(ClassLoaderReference.Application).iterateAllClasses().forEachRemaining(clazz -> {
            for (IMethod m : clazz.getDeclaredMethods()) {
                boolean eligible = filterByName
                    ? entryMethodNames.contains(m.getName().toString())
                    : (m.isPublic() && !m.isInit() && !m.isClinit());
                if (eligible && !m.isAbstract() && !m.isNative()) {
                    entries.add(new DefaultEntrypoint(m, cha));
                }
            }
        });
        if (entries.isEmpty()) {
            return List.of();
        }

        AnalysisOptions options = new AnalysisOptions(scope, entries);
        CallGraphBuilder<InstanceKey> builder =
            Util.makeZeroOneCFABuilder(Language.JAVA, options, new AnalysisCacheImpl(), cha);
        CallGraph cg = builder.makeCallGraph(options, new NullProgressMonitor());
        PointerAnalysis<InstanceKey> pa = builder.getPointerAnalysis();

        ISourceSinkDefinitionProvider provider = SourceSinkJSONProvider.fromContent(sasJson);
        TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain =
            new TaintDomain<>(DomainElement.ZERO);

        SolverManager manager = new SolverManager(TaintAnalysisConfig.builder()
            .withAppName("repograph-precise-taint")
            .withRuleName(ruleName)
            .withPointerAnalysis(pa)
            .withCallGraph(cg)
            .withSasProvider(provider)
            .withDomain(domain)
            .withTaintWrapper(null)
            .build());

        ITaintSolver solver = new TaintSolver(manager);
        solver.runAnalysis();
        TaintResult result = solver.getTaintResult();

        List<TaintFlowDto> flows = new ArrayList<>();
        for (Flow flow : result.getFlows()) {
            String sourceSig = flow.getFrom() != null ? flow.getFrom().getMethodSignature() : "";
            String sinkSig = flow.getTo() != null ? flow.getTo().getMethodSignature() : "";
            String sinkClass = "";
            if (flow.getTo() != null && flow.getTo().getMethod() != null) {
                sinkClass = flow.getTo().getMethod().getDeclaringClass().getName().toString();
            }
            int sourceLine;
            try {
                sourceLine = flow.getSourceLineNumber();
            } catch (Exception e) {
                sourceLine = -1;
            }
            String detail = flow.getStep().stream()
                .map(md -> md.getMethodSignature())
                .collect(Collectors.joining(" -> "));
            flows.add(new TaintFlowDto(ruleName, sourceSig, sinkSig, sinkClass, sourceLine, detail));
        }
        return flows;
    }

    /**
     * 引擎多处通过 {@link GlobalCache} 读取全局 {@link IContext}(getCheckConfig / getRule)。
     * 独立进程无 RuleFactory 引导流程,此处注入最小可用上下文。
     */
    private static void installContext(String ruleName) {
        CheckConfig checkConfig = CheckConfig.builder()
            .withPhantom(false)
            .withSparseOn(true)
            .build();
        DefaultContext ctx = IContext.builder()
            .withTaskName("repograph-precise-taint")
            .withCheckConfig(checkConfig)
            .withRule(new IRule() {
                @Override
                public String getCurrentRuleNumber() {
                    return "CA-PRECISE-" + ruleName;
                }

                @Override
                public String getCurrentRuleName() {
                    return ruleName;
                }
            })
            .build();
        GlobalCache.INSTANCE.put(GlobalCache.DEFAULT_KEY, ctx);
    }

    /** 将打包的默认排除文件释放到临时文件(makeJavaBinaryAnalysisScope 需要 File)。 */
    private static File defaultExclusionsFile() throws Exception {
        try (InputStream in = TaintScanRunner.class.getResourceAsStream("/JavaTaintExclusions.txt")) {
            if (in == null) {
                return null;
            }
            Path tmp = Files.createTempFile("JavaTaintExclusions", ".txt");
            Files.copy(in, tmp, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            tmp.toFile().deleteOnExit();
            return tmp.toFile();
        }
    }
}
