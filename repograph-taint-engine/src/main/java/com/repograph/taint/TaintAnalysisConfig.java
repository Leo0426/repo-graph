package com.repograph.taint;

import com.repograph.taint.sourcesink.ISourceSinkDefinitionProvider;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.taintWrappers.ITaintPropagationWrapper;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;

/**
 * config form.
 *
 * @author leolu
 * @since 2025/3/10
 */
public class TaintAnalysisConfig {

	/**
	 * Name of the application being analyzed for taints.
	 */
	private String appName;

	/**
	 * Name of the weaknesses being analyzed.
	 */
	private String ruleName;

	/**
	 * Pointer Analysis information, used for context-sensitive taint analysis.
	 */
	private PointerAnalysis<InstanceKey> pointerAnalysis;

	/**
	 * Call graph representation that helps in navigating the execution flow.
	 */
	private CallGraph callGraph;

	/**
	 * Source and Sink definition provider to identify critical vulnerability points.
	 */
	private ISourceSinkDefinitionProvider sasProvider;

	/**
	 * Domain for Null Pointer Dereference (NPD) analysis.
	 */
	private TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;

	/**
	 * Taint Propagation Wrapper for managing taint data movement throughout the analysis.
	 */
	private ITaintPropagationWrapper<IDomainElement> taintWrapper;

	public String getAppName() {
		return appName;
	}

	public void setAppName(String appName) {
		this.appName = appName;
	}

	public String getRuleName() {
		return ruleName;
	}

	public void setRuleName(String ruleName) {
		this.ruleName = ruleName;
	}

	public PointerAnalysis<InstanceKey> getPointerAnalysis() {
		return pointerAnalysis;
	}

	public void setPointerAnalysis(PointerAnalysis<InstanceKey> pointerAnalysis) {
		this.pointerAnalysis = pointerAnalysis;
	}

	public CallGraph getCallGraph() {
		return callGraph;
	}

	public void setCallGraph(CallGraph callGraph) {
		this.callGraph = callGraph;
	}

	public ISourceSinkDefinitionProvider getSasProvider() {
		return sasProvider;
	}

	public void setSasProvider(ISourceSinkDefinitionProvider sasProvider) {
		this.sasProvider = sasProvider;
	}

	public TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> getDomain() {
		return domain;
	}

	public void setDomain(TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain) {
		this.domain = domain;
	}

	public ITaintPropagationWrapper<IDomainElement> getTaintWrapper() {
		return taintWrapper;
	}

	public void setTaintWrapper(ITaintPropagationWrapper<IDomainElement> taintWrapper) {
		this.taintWrapper = taintWrapper;
	}

	public static TaintAnalysisConfigBuilder builder() {
		return new TaintAnalysisConfigBuilder();
	}

	public static final class TaintAnalysisConfigBuilder {
		private String appName;
		private String ruleName;
		private PointerAnalysis<InstanceKey> pointerAnalysis;
		private CallGraph callGraph;
		private ISourceSinkDefinitionProvider sasProvider;
		private TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;
		private ITaintPropagationWrapper<IDomainElement> taintWrapper;

		private TaintAnalysisConfigBuilder() {
		}

		public TaintAnalysisConfigBuilder withAppName(String appName) {
			this.appName = appName;
			return this;
		}

		public TaintAnalysisConfigBuilder withRuleName(String ruleName) {
			this.ruleName = ruleName;
			return this;
		}

		public TaintAnalysisConfigBuilder withPointerAnalysis(PointerAnalysis<InstanceKey> pointerAnalysis) {
			this.pointerAnalysis = pointerAnalysis;
			return this;
		}

		public TaintAnalysisConfigBuilder withCallGraph(CallGraph callGraph) {
			this.callGraph = callGraph;
			return this;
		}

		public TaintAnalysisConfigBuilder withSasProvider(ISourceSinkDefinitionProvider sasProvider) {
			this.sasProvider = sasProvider;
			return this;
		}

		public TaintAnalysisConfigBuilder withDomain(TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain) {
			this.domain = domain;
			return this;
		}

		public TaintAnalysisConfigBuilder withTaintWrapper(ITaintPropagationWrapper<IDomainElement> taintWrapper) {
			this.taintWrapper = taintWrapper;
			return this;
		}

		public TaintAnalysisConfig build() {
			TaintAnalysisConfig taintAnalysisConfig = new TaintAnalysisConfig();
			taintAnalysisConfig.setAppName(appName);
			taintAnalysisConfig.setRuleName(ruleName);
			taintAnalysisConfig.setPointerAnalysis(pointerAnalysis);
			taintAnalysisConfig.setCallGraph(callGraph);
			taintAnalysisConfig.setSasProvider(sasProvider);
			taintAnalysisConfig.setDomain(domain);
			taintAnalysisConfig.setTaintWrapper(taintWrapper);
			return taintAnalysisConfig;
		}
	}
}


