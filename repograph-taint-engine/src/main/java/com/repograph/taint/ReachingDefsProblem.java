package com.repograph.taint;

import com.repograph.taint.api.IContext;
import com.repograph.taint.api.cache.GlobalCache;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.flow.sparse.SparseFlowFunctionMap;
import com.repograph.taint.propagation.ITaintPropagationRule;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.propagation.WrapperPropagationRule;
import com.repograph.taint.rules.SAMSparseRule;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.dataflow.IFDS.IMergeFunction;
import com.ibm.wala.dataflow.IFDS.IPartiallyBalancedFlowFunctions;
import com.ibm.wala.dataflow.IFDS.ISupergraph;
import com.ibm.wala.dataflow.IFDS.PartiallyBalancedTabulationProblem;
import com.ibm.wala.dataflow.IFDS.PathEdge;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.collections.HashSetFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.Set;

import static java.util.Objects.nonNull;

/**
 * ReachingDefsProblem
 *
 * @author leolu
 * @since 2024/1/30
 */
public class ReachingDefsProblem
	implements PartiallyBalancedTabulationProblem<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> {

	private static final Logger LOGGER = LoggerFactory.getLogger(ReachingDefsProblem.class);

	private final SolverManager solverManager;
	private final IPartiallyBalancedFlowFunctions<BasicBlockInContext<IExplodedBasicBlock>> partiallyBalancedFlowFunctions;
	private final IContext completeContext = GlobalCache.INSTANCE.get(GlobalCache.DEFAULT_KEY);

	/**
	 * path edges corresponding to all  instructions, used as seeds for the analysis
	 */
	private final Collection<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> initialSeeds;

	public ReachingDefsProblem(SolverManager solverManager,
							   Collection<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> pathEdges) {
		this.solverManager = solverManager;
		if (nonNull(pathEdges) && !pathEdges.isEmpty()) {
			this.initialSeeds = pathEdges;
		} else {
			this.initialSeeds = this.initSeedsBy();
		}

		ArrayList<ITaintPropagationRule> ruleList = new ArrayList<>();
		ruleList.add(new WrapperPropagationRule<>(solverManager));
		ruleList.add(new SAMSparseRule(solverManager));
		PropagationRuleManager propagationRuleManager = new PropagationRuleManager(ruleList);

		if (completeContext.getCheckConfig().isSparseOn()) {
			this.partiallyBalancedFlowFunctions = new SparseFlowFunctionMap<>(solverManager, propagationRuleManager);
		} else {
			this.partiallyBalancedFlowFunctions = new SparseFlowFunctionMap<>(solverManager, propagationRuleManager);
		}

	}

	@Override
	public IPartiallyBalancedFlowFunctions<BasicBlockInContext<IExplodedBasicBlock>> getFunctionMap() {
		return this.partiallyBalancedFlowFunctions;
	}

	@Override
	public BasicBlockInContext<IExplodedBasicBlock> getFakeEntry(
		BasicBlockInContext<IExplodedBasicBlock> basicBlockBasicBlockInContext) {
		CGNode node = basicBlockBasicBlockInContext.getNode();
		return getFakeEntry(node);
	}


	/**
	 * we use the entry block of the CGNode as the "fake" entry when propagating from callee to
	 * caller with unbalanced parens
	 */
	private BasicBlockInContext<IExplodedBasicBlock> getFakeEntry(final CGNode cgNode) {
		BasicBlockInContext<IExplodedBasicBlock>[] entriesForProcedure = this.solverManager.getICFGSuperGraph()
			.getEntriesForProcedure(cgNode);
		assert entriesForProcedure.length == 1;
		return entriesForProcedure[0];
	}

	@Override
	public TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> getDomain() {
		return this.solverManager.getDomain();
	}

	/**
	 * we don't need a merge function; the default unioning of tabulation works fine
	 */
	@Override
	public IMergeFunction getMergeFunction() {
		return null;
	}

	@Override
	public ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> getSupergraph() {
		return this.solverManager.getICFGSuperGraph();
	}

	@Override
	public Collection<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> initialSeeds() {
		return this.initialSeeds;
	}


	private Collection<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> initSeedsBy() {
		Set<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> result = HashSetFactory.make();
		this.solverManager.getSourceSinkManager().iterator()
			.forEachRemaining((e) ->
				e.getSources()
					.forEach((x) -> {
						CGNode cgNode = x.getNode();
						LOGGER.debug(cgNode.getMethod().getSignature());
						BasicBlockInContext<IExplodedBasicBlock> bb = this.getEntryBB(cgNode);
						result.add(PathEdge.createPathEdge(bb, 0, x, 0));
					}));
		if (!Engine.searchEntriesByMain(this.solverManager.getClassHierarchy()).isEmpty()) {
			BasicBlockInContext<IExplodedBasicBlock>[] entriesForProcedure
				= this.solverManager.getICFGSuperGraph()
				.getEntriesForProcedure(this.solverManager.getCallgraph().getFakeRootNode());
			for (BasicBlockInContext<IExplodedBasicBlock> bb : entriesForProcedure) {
				result.add(PathEdge.createPathEdge(bb, 0, bb, 0));
			}
		}
		return result;
	}


	private BasicBlockInContext<IExplodedBasicBlock> getEntryBB(CGNode cgNode) {
		var entries = this.solverManager.getICFGSuperGraph().getEntriesForProcedure(cgNode);
		if (entries.length == 1) {
			return entries[0];
		} else {
			return Arrays.stream(entries)
				.min(Comparator.comparingInt(b -> b.getDelegate().getFirstInstructionIndex()))
				.orElseThrow(() -> new IllegalStateException("No entry block for: " + cgNode));
		}
	}


	public PointerAnalysis<InstanceKey> getPointerAnalysis() {
		return this.solverManager.getPointerAnalysis();
	}

	public void clear() {
		if (this.partiallyBalancedFlowFunctions instanceof SparseFlowFunctionMap) {
			((SparseFlowFunctionMap<?>) this.partiallyBalancedFlowFunctions).clear();
		}
	}

}
