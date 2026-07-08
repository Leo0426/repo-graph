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
import com.repograph.taint.domain.element.NPDDomainElement;
import com.repograph.taint.npdnorm.ifds.NullPointerDeferenceDomain;
import com.repograph.taint.npdnorm.ifds.solver.NPDSolver;
import com.repograph.taint.npdnorm.ifds.solver.NPDSolverManager;
import com.repograph.taint.rules.SummaryTaintWrapper;
import com.repograph.taint.solver.SolverManager;
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

public class CWE476TestCase {

	private static final Logger LOGGER = LoggerFactory.getLogger(CWE476TestCase.class);

	protected String appName = "test";
	protected String sourceSinkFile;
	protected String wrapperFile;
	protected PointerAnalysis<InstanceKey> pa;
	protected SolverManager manager = null;

	public static void main(String[] args) {
		Path path = Paths.get("/Users/leolu/Project/personal_projects/test_case/java_test_case/Juliet/Juliet/Juliet_Test_Suite/src/testcases/CWE476_NULL_Pointer_Dereference");

		DefaultContext build = IContext.builder()
			.withTaskName("clouditera-java-engine")
			.withOutputPath(path)
			.withCheckConfig(
				CheckConfig.builder()
					.withPhantom(false)
					.build()
			)
			.withRule(new IRule() {
				@Override
				public String getCurrentRuleNumber() {
					return "CA-JAVA-CWE_0051";
				}

				@Override
				public String getCurrentRuleName() {
					return "CWE_476";
				}
			})
			.withRules(new ArrayList<>())
			.withTargetPath(List.of(path))
			.withSourceFileConfig(new SourceFileConfig("/opt/config"))
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

		CWE476TestCase cwe476TestCase = new CWE476TestCase();
		cwe476TestCase.test(pointerAnalysis);
		cwe476TestCase.runOnModule(propagationTransform.getCgNodes());
	}

	public void test(PointerAnalysis<InstanceKey> pa) {
		this.sourceSinkFile = "/opt/config/sources_and_sinks/CWE-476-NullpointerDeference.json";
		this.wrapperFile = "/opt/config/npd_summary";
		this.pa = pa;
	}

	public void runOnModule(CallGraph callGraph) {
		try {
			NPDSolver solver = createNPESolver(callGraph);
			solver.runAnalysis();
			TaintResult answer = solver.getAnswer();

			DefaultVisitor defaultVisitor = new DefaultVisitor();
			defaultVisitor.exportResult(new IRule() {
				@Override
				public String getCurrentRuleNumber() {
					return "CA-JAVA-CWE_0051";
				}

				@Override
				public String getCurrentRuleName() {
					return "CWE_476";
				}
			}, answer);

		} catch (IOException e) {
			LOGGER.error("run NPE get an exception : {}", e.getMessage());
		}
	}


	protected NPDSolver createNPESolver(CallGraph callgraph) throws IOException {

		// Step 1: Create a new domain for Null Pointer Dereference analysis
		// This domain will handle the tabulation of elements within the context of basic blocks.
		TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> npdDomain
			= new NullPointerDeferenceDomain<>(NPDDomainElement.ZERO);

		// Step 2: Initialize a SourceSinkDefinitionProvider from the given source sink file
		// This provider will map source and sink definitions for taint analysis.
		ISourceSinkDefinitionProvider provider = SourceSinkJSONProvider.fromFile(sourceSinkFile);

		// Step 3: Check if the wrapper file is a directory and create a taint wrapper if required
		// This wrapper will enable customized taint propagation.
		ITaintPropagationWrapper<IDomainElement> wrapper = null;
		if (isDir(wrapperFile)) {
			wrapper = new SummaryTaintWrapper("CWE476", wrapperFile, callgraph, pa);
		}

		// Step 4: Build the TaintAnalysisConfig by assembling all required components and settings
		// This configuration encapsulates the application name, rule name, pointer analysis,
		// call graph, source-sink provider, domain, and taint wrapper.
		TaintAnalysisConfig config = TaintAnalysisConfig.builder()
			.withAppName(appName)
			.withRuleName("CWE476")
			.withPointerAnalysis(pa)
			.withCallGraph(callgraph)
			.withSasProvider(provider)
			.withDomain(npdDomain)
			.withTaintWrapper(wrapper)
			.build();

		// Step 5: Initialize the solver manager with the created configuration
		manager = new NPDSolverManager(config);

		// Step 6: Return a new NullPointerDereferenceSolver configured with the solver manager
		return new NPDSolver(manager);
	}

}
