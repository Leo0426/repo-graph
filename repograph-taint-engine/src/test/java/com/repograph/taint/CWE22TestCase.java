package com.repograph.taint;

import com.repograph.taint.api.CheckConfig;
import com.repograph.taint.api.DefaultContext;
import com.repograph.taint.api.IContext;
import com.repograph.taint.api.IPropagationTransform;
import com.repograph.taint.api.cache.GlobalCache;
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
import com.repograph.taint.domain.element.NPDDomainElement;
import com.repograph.taint.npdnorm.ifds.NullPointerDeferenceDomain;
import com.repograph.taint.npdnorm.ifds.solver.NPDSolver;
import com.repograph.taint.npdnorm.ifds.solver.NPDSolverManager;
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

public class CWE22TestCase {

	private static final Logger LOGGER = LoggerFactory.getLogger(CWE22TestCase.class);

	protected String appName = "test";
	protected String sourceSinkFile;
	protected String wrapperFile;
	protected PointerAnalysis<InstanceKey> pa;
	protected SolverManager manager = null;

	public static void main(String[] args) {
		Path path = Paths.get("/Users/leolu/Downloads/test-case/aigc-client/aigc-client");

		DefaultContext build = IContext.builder()
			.withTaskName("java-engine")
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
					return "CWE_22";
				}
			})
			.withRules(new ArrayList<>())
			.withTargetPath(List.of(path))
			.withSourceFileConfig(new SourceFileConfig("/opt/"))
			.withTargetAllFilePath(null)
			.build();

		// engine facade
		RuleFactory ruleFactory = new RuleFactory(build);
		ruleFactory.initialize();
		ruleFactory.registerRules();
		ruleFactory.startRules();
		IContext iContext = GlobalCache.INSTANCE.get(DEFAULT_KEY);
		IPropagationTransform propagationTransform = iContext.getPropagationTransform();
		PointerAnalysis<InstanceKey> pointerAnalysis = propagationTransform.getPointerAnalysis();

		CWE22TestCase cwe476TestCase = new CWE22TestCase();
		cwe476TestCase.test(pointerAnalysis);
		cwe476TestCase.runOnModule(propagationTransform.getCgNodes());
	}

	public void test(PointerAnalysis<InstanceKey> pa) {
		this.sourceSinkFile = "/opt/config/sources_and_sinks/CWE-22-pathTraversal.json";
		this.wrapperFile = "/opt/config/summary";
		this.pa = pa;
	}

	public void runOnModule(CallGraph callGraph) {
		try {
			ITaintSolver solver = createTaintSolver(callGraph);
			solver.runAnalysis();
			TaintResult answer = solver.getTaintResult();

			DefaultVisitor defaultVisitor = new DefaultVisitor();
			defaultVisitor.exportResult(new IRule() {
				@Override
				public String getCurrentRuleNumber() {
					return "CA-JAVA-CWE_0007";
				}

				@Override
				public String getCurrentRuleName() {
					return "CWE_22";
				}
			}, answer);

		} catch (IOException e) {
			LOGGER.error("run NPE get an exception : {}", e.getMessage());
		}
	}

	protected ITaintSolver createTaintSolver(CallGraph callgraph) throws IOException {
		// find all source and sink file.
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
			.withAppName("sast-java")
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
