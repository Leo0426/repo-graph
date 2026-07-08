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
import com.repograph.taint.report.expoter.TaintBugJsonExport;
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

import static com.repograph.taint.extutil.FileUtils.isDir;
import static com.repograph.taint.extutil.FileUtils.isTXTFile;

public class TaintPass {

	private static final Logger LOGGER = LoggerFactory.getLogger(TaintPass.class);

	protected String sourceSinkFile;
	protected String wrapperFile;
	protected final PointerAnalysis<InstanceKey> pa;
	protected SolverManager manager = null;

	private TaintPass(PointerAnalysis<InstanceKey> pa) {
		this.pa = pa;
		this.sourceSinkFile = "/opt/config/sources_and_sinks/CWE-89-sqlInject.json";
		this.wrapperFile = "/opt/config/summary";
	}

	public static void main(String[] args) throws IOException {

		Path path = Paths.get("/Users/leolu/Project/personal_projects/test_case/java_test_case/Juliet/Juliet/Juliet_Test_Suite/src/testcases/CWE89_SQL_Injection/s01/antbuild/testcases/CWE89_SQL_Injection/s01");

		DefaultContext build = IContext.builder()
			.withTaskName("clouditera-java-engine")
			.withOutputPath(path)
			.withRules(new ArrayList<>())
			.withTargetPath(List.of(path))
			.withCheckConfig(CheckConfig.builder()
				.withPhantom(false)
				.build())
			.withSourceFileConfig(new SourceFileConfig("/opt/config"))
			.withTargetAllFilePath(null)
			.build();

		// engine facade
		RuleFactory ruleFactory = new RuleFactory(build);
		ruleFactory.initialize();
		ruleFactory.registerRules();
		ruleFactory.startRules();
		DefaultContext aDefault = (DefaultContext) GlobalCache.INSTANCE.getDefault();
		aDefault.setRule(new IRule() {
			@Override
			public String getCurrentRuleNumber() {
				return "CWE89";
			}

			@Override
			public String getCurrentRuleName() {
				return "CWE89";
			}
		});

		IPropagationTransform propagationTransform = aDefault.getPropagationTransform();
		PointerAnalysis<InstanceKey> pointerAnalysis = propagationTransform.getPointerAnalysis();
		TaintPass taintPass = new TaintPass(pointerAnalysis);
		taintPass.runOnModule(propagationTransform.getCgNodes());
	}

	public void runOnModule(CallGraph callGraph) {
		try {
			ITaintSolver taintSolver = createTaintSolver(callGraph);
			taintSolver.runAnalysis();
			TaintResult answer = taintSolver.getTaintResult();

			TaintBugJsonExport instance = TaintBugJsonExport.getInstance();
			instance.setBugJsonPath(Paths.get("."));
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
			wrapper = new SummaryTaintWrapper("CWE89", wrapperFile, callgraph, pa);
		} else if (isTXTFile(wrapperFile)) {
			wrapper = new EasyTaintWrapper(wrapperFile);
		}

		manager = new SolverManager(TaintAnalysisConfig.builder()
			.withAppName("test")
			.withRuleName("CWE89")
			.withPointerAnalysis(pa)
			.withCallGraph(callgraph)
			.withSasProvider(provider)
			.withDomain(domain)
			.withTaintWrapper(wrapper)
			.build());

		return new TaintSolver(manager);
	}
}
