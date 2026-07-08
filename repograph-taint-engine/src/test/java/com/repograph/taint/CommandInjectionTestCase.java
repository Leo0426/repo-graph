package com.repograph.taint;

import com.repograph.taint.api.CheckConfig;
import com.repograph.taint.api.DefaultContext;
import com.repograph.taint.api.IContext;
import com.repograph.taint.api.IPropagationTransform;
import com.repograph.taint.api.cache.GlobalCache;
import com.repograph.taint.api.report.taint.Flow;
import com.repograph.taint.api.report.taint.TaintResult;
import com.repograph.taint.api.rules.IRule;
import com.repograph.taint.api.support.SourceFileConfig;
import com.repograph.taint.invoke.factory.RuleFactory;
import com.repograph.taint.report.visitor.DefaultVisitor;
import com.repograph.taint.sourcesink.ISourceSinkDefinitionProvider;
import com.repograph.taint.sourcesink.SourceSinkJSONProvider;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.TaintDomain;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.rules.EasyTaintWrapper;
import com.repograph.taint.rules.SummaryTaintWrapper;
import com.repograph.taint.solver.ITaintSolver;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.solver.TaintSolver;
import com.repograph.taint.taintWrappers.ITaintPropagationWrapper;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import static com.repograph.taint.api.cache.GlobalCache.DEFAULT_KEY;
import static com.repograph.taint.extutil.FileUtils.isDir;
import static com.repograph.taint.extutil.FileUtils.isTXTFile;

/**
 * Test case for command injection vulnerability detection.
 * This test verifies that the taint analysis engine can detect the command injection vulnerability
 * in the CommandInjectionTest class, where tainted data flows from a parameter through Invoke.chooseOne()
 * to Runtime.exec().
 */
public class CommandInjectionTestCase {

    private static final Logger LOGGER = LoggerFactory.getLogger(CommandInjectionTestCase.class);

    protected String sourceSinkFile;
    protected String wrapperFile;
    protected PointerAnalysis<InstanceKey> pa;
    protected SolverManager manager = null;

    public static void main(String[] args) {
        CommandInjectionTestCase testCase = new CommandInjectionTestCase();
        testCase.testCommandInjection();
    }

    public void testCommandInjection() {
        // Get the path to the compiled test classes
        Path path = Paths.get("build/classes/java/test");

        // Create a context for the analysis
        DefaultContext context = IContext.builder()
            .withTaskName("command-injection-test")
            .withOutputPath(Paths.get("."))
            .withCheckConfig(
                CheckConfig.builder()
                    .withPhantom(false)
                    .build()
            )
            .withRule(new IRule() {
                @Override
                public String getCurrentRuleNumber() {
                    return "CA-JAVA-CWE_0007";
                }

                @Override
                public String getCurrentRuleName() {
                    return "CWE_78";
                }
            })
            .withRules(new ArrayList<>())
            .withTargetPath(List.of(path))
            .withSourceFileConfig(new SourceFileConfig("src/main/resources/config"))
            .withTargetAllFilePath(null)
            .build();

        // Initialize the rule factory
        RuleFactory ruleFactory = new RuleFactory(context);
        ruleFactory.initialize();
        ruleFactory.registerRules();
        ruleFactory.startRules();
        IContext iContext = GlobalCache.INSTANCE.get(DEFAULT_KEY);
        IPropagationTransform propagationTransform = iContext.getPropagationTransform();
        PointerAnalysis<InstanceKey> pointerAnalysis = propagationTransform.getPointerAnalysis();

        // Run the test
        CommandInjectionTestCase testCase = new CommandInjectionTestCase();
        testCase.test(pointerAnalysis);
        testCase.runOnModule(propagationTransform.getCgNodes());
    }

    public void test(PointerAnalysis<InstanceKey> pa) {
        this.sourceSinkFile = "src/main/resources/config/SourceAndSink/CWE-78-OSCmdInject.json";
        this.wrapperFile = "src/main/resources/config/summary";
        this.pa = pa;
    }

    public void runOnModule(CallGraph callGraph) {
        try {
            ITaintSolver solver = createTaintSolver(callGraph);
            solver.runAnalysis();
            TaintResult answer = solver.getTaintResult();

            // Print the results
            LOGGER.info("Taint analysis completed. Found {} flows.", answer.getFlows().size());
            for (Flow flow : answer.getFlows()) {
                LOGGER.info("Found flow: {}", String.valueOf(flow));
            }

            DefaultVisitor defaultVisitor = new DefaultVisitor();
            defaultVisitor.exportResult(new IRule() {
                @Override
                public String getCurrentRuleNumber() {
                    return "CA-JAVA-CWE_0007";
                }

                @Override
                public String getCurrentRuleName() {
                    return "CWE_78";
                }
            }, answer);

        } catch (IOException e) {
            LOGGER.error("Run analysis got an exception: {}", e.getMessage());
        }
    }

    protected ITaintSolver createTaintSolver(CallGraph callgraph) throws IOException {
        // Load source and sink definitions
        ISourceSinkDefinitionProvider provider = SourceSinkJSONProvider.fromFile(sourceSinkFile);

        TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain
            = new TaintDomain<>(DomainElement.ZERO);

        ITaintPropagationWrapper<IDomainElement> wrapper = null;
        if (isDir(wrapperFile)) {
            wrapper = new SummaryTaintWrapper("CWE78", wrapperFile, callgraph, pa);
        } else if (isTXTFile(wrapperFile)) {
            wrapper = new EasyTaintWrapper(wrapperFile);
        }

        manager = new SolverManager(TaintAnalysisConfig.builder()
            .withAppName("command-injection-test")
            .withRuleName("CWE78")
            .withPointerAnalysis(pa)
            .withCallGraph(callgraph)
            .withSasProvider(provider)
            .withDomain(domain)
            .withTaintWrapper(wrapper)
            .build());

        return new TaintSolver(manager);
    }
}
