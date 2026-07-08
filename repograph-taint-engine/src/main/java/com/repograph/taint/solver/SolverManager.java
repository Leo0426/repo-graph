package com.repograph.taint.solver;

import com.repograph.taint.sourcesink.ISourceSinkDefinitionProvider;
import com.repograph.taint.sourcesink.KillManager;
import com.repograph.taint.sourcesink.SourceSinkGroup;
import com.repograph.taint.sourcesink.SourceSinkManager;
import com.repograph.taint.TaintAnalysisConfig;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.TaintDomain;
import com.repograph.taint.taintWrappers.ITaintPropagationWrapper;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.dataflow.IFDS.BackwardsSupergraph;
import com.ibm.wala.dataflow.IFDS.ICFGSupergraph;
import com.ibm.wala.dataflow.IFDS.ISupergraph;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;

import java.util.Set;


/**
 * The SolverManager class manages the execution and configuration of the taint analysis process,
 * integrating and coordinating various components such as call graphs, pointer analysis, and source-sink management.
 * <p>
 * This class is primarily responsible for orchestrating domain handling, source-sink group management,
 * graph generation (both forward and backward), and taint propagation configurations.
 */
public class SolverManager implements ISolverManager<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> {

	private final String ruleType;
	private final String appName;
	private final IClassHierarchy cha;

	private final KillManager mKillManager;
	private final SourceSinkManager mSourceSinkManager;
	private SourceSinkGroup currSSG;
	private TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;

	private final CallGraph callgraph;
	private final PointerAnalysis<InstanceKey> pa;
	private final ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> isg;
	private final ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> bisg;
	private final ITaintPropagationWrapper<IDomainElement> taintWrapper;

	/**
	 * Constructs a SolverManager instance for managing taint analysis configurations.
	 *
	 * @param config the TaintAnalysisConfig object providing the necessary configuration
	 *               inputs like call graphs, pointer analysis, and domain elements; must not be null.
	 *               This object is also used for initializing source-sink management.
	 */
	public SolverManager(TaintAnalysisConfig config) {

		CallGraph cg = config.getCallGraph();
		PointerAnalysis<InstanceKey> pa = config.getPointerAnalysis();
		ISourceSinkDefinitionProvider sasProvider = config.getSasProvider();
		this.taintWrapper = config.getTaintWrapper();
		TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> npdDomain = config.getDomain();

		this.ruleType = config.getRuleName();
		this.appName = config.getAppName();
		this.cha = cg.getClassHierarchy();
		this.callgraph = cg;
		this.pa = pa;

		this.domain = npdDomain;
		this.isg = ICFGSupergraph.make(callgraph);
		this.bisg = BackwardsSupergraph.make(isg);

		this.mSourceSinkManager = new SourceSinkManager(ruleType, cha, sasProvider, isg);

		if (sasProvider != null) {
			this.mKillManager = new KillManager(cg, sasProvider.getKills());
		} else {
			this.mKillManager = new KillManager(cg, null);
		}
		this.currSSG = null;

		if (taintWrapper != null && sasProvider != null) {
			taintWrapper.addKillSet(sasProvider.getKills());
		}
	}

	/**
	 * Copy constructor for SolverManager. It creates a new instance by copying data from an existing SolverManager.
	 *
	 * @param mgr the source SolverManager instance to copy from; must not be null.
	 */
	public SolverManager(SolverManager mgr) {
		this.ruleType = mgr.getRuleKind();
		this.appName = mgr.getAppName();
		this.cha = mgr.getClassHierarchy();
		this.mSourceSinkManager = mgr.getSourceSinkManager();
		this.mKillManager = mgr.getKillManager();
		this.domain = mgr.getDomain();
		this.callgraph = mgr.getCallgraph();
		this.pa = mgr.getPointerAnalysis();
		this.isg = mgr.getICFGSuperGraph();
		this.bisg = mgr.getBackwardICFGSuperGraph(); // reverse the arrow direction
		this.taintWrapper = mgr.getTaintWrapper();
		this.currSSG = mgr.getCurrentSourceSinkGroup();
	}

	/**
	 * Retrieves the sources in the current source-sink group being managed.
	 *
	 * @return a set of source basic blocks in the current SourceSinkGroup.
	 * @throws AssertionError if the current SourceSinkGroup is null.
	 */
	public Set<BasicBlockInContext<IExplodedBasicBlock>> getSources() {
		assert this.currSSG != null;
		return currSSG.getSources();
	}

	/**
	 * Retrieves all public methods identified by the SourceSinkManager.
	 *
	 * @return a set of IMethod instances representing public methods in the application.
	 */
	public Set<IMethod> getPublicMethods() {
		return mSourceSinkManager.getPublicMethods();
	}

	/**
	 * Retrieves all public nodes in the CallGraph identified by the SourceSinkManager.
	 *
	 * @return a set of CGNode instances representing public call graph nodes.
	 */
	public Set<CGNode> getPublicCGNodes() {
		return mSourceSinkManager.getPublicCGNodes();
	}

	/**
	 * Retrieves the sinks in the current source-sink group being managed.
	 *
	 * @return a set of sink basic blocks in the current SourceSinkGroup.
	 * @throws AssertionError if the current SourceSinkGroup is null.
	 */
	public Set<BasicBlockInContext<IExplodedBasicBlock>> getSinks() {
		assert this.currSSG != null;
		return currSSG.getSinks();
	}

	@Override
	public CallGraph getCallgraph() {
		return callgraph;
	}

	@Override
	public IClassHierarchy getClassHierarchy() {
		return cha;
	}

	/**
	 * Gets the currently active source-sink group.
	 *
	 * @return the current SourceSinkGroup being managed, or null if not set.
	 */
	@Override
	public SourceSinkGroup getCurrentSourceSinkGroup() {
		return this.currSSG;
	}

	/**
	 * Sets the current source-sink group to the provided SourceSinkGroup instance.
	 *
	 * @param ssg the SourceSinkGroup to set as the currently active group; can be null.
	 */
	public void setCurrentSourceSinkGroup(SourceSinkGroup ssg) {
		this.currSSG = ssg;
	}

	@Override
	public SourceSinkManager getSourceSinkManager() {
		return mSourceSinkManager;
	}

	/**
	 * Retrieves the KillManager instance responsible for managing kill operations in the analysis (i.e.,
	 * elements that are no longer active in the propagation process).
	 *
	 * @return the current KillManager instance.
	 */
	public KillManager getKillManager() {
		return mKillManager;
	}

	@Override
	public TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> getDomain() {
		return domain;
	}

	/**
	 * Updates the tabulation domain being managed by this SolverManager.
	 * <p>
	 * If the existing domain is a TaintDomain instance, its cleanup routine is invoked
	 * to release associated resources before replacing it with the new domain.
	 *
	 * @param domain the new TabulationDomain to manage; must not be null.
	 */
	public void setDomain(TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain) {
		if (this.domain != null) {
			if (this.domain instanceof TaintDomain) {
				((TaintDomain<?>) this.domain).cleanup();
			}
		}
		this.domain = domain;
	}

	@Override
	public PointerAnalysis<InstanceKey> getPointerAnalysis() {
		return pa;
	}

	@Override
	public ITaintPropagationWrapper<IDomainElement> getTaintWrapper() {
		return taintWrapper;
	}

	@Override
	public ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> getICFGSuperGraph() {
		return isg;
	}

	@Override
	public ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> getBackwardICFGSuperGraph() {
		return bisg;
	}

	@Override
	public String getAppName() {
		return appName;
	}

	@Override
	public String getRuleKind() {
		return ruleType;
	}
}
