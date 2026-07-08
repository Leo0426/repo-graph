package com.repograph.taint.npdnorm.ifds.solver;

import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.npdnorm.ifds.flow.NPDFlowFunctionMap;
import com.repograph.taint.propagation.ITaintPropagationRule;
import com.repograph.taint.propagation.NullRules;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.propagation.WrapperPropagationRule;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.dataflow.IFDS.IMergeFunction;
import com.ibm.wala.dataflow.IFDS.IPartiallyBalancedFlowFunctions;
import com.ibm.wala.dataflow.IFDS.ISupergraph;
import com.ibm.wala.dataflow.IFDS.PartiallyBalancedTabulationProblem;
import com.ibm.wala.dataflow.IFDS.PathEdge;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.collections.HashSetFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Set;


public class NpdProblem
	implements PartiallyBalancedTabulationProblem<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> {

	private static final Logger LOGGER = LoggerFactory.getLogger(NpdProblem.class);

	private final SolverManager solverManager;
	/**
	 * Manages the flow functions required for the taint analysis, including how data flows between different
	 * points in the program.
	 */
	private final IPartiallyBalancedFlowFunctions<BasicBlockInContext<IExplodedBasicBlock>> partiallyBalancedFlowFunctions;

	/**
	 * path edges corresponding to all  instructions, used as seeds for the analysis
	 */
	private final Collection<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> initialSeeds;


	/**
	 * Constructs an {@code NpdProblem} instance to define a taint
	 * analysis problem with given flow functions and seeds required for initialization.
	 *
	 * @param solverManager manages the solving and analysis process.
	 * @param initialSeeds  the initial set of path edges to start the analysis.
	 */
	public NpdProblem(SolverManager solverManager,
					  Collection<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> initialSeeds) {
		this.solverManager = solverManager;
		if (initialSeeds.isEmpty()) {
			this.initialSeeds = initSeedsBy();
		} else {
			this.initialSeeds = initialSeeds;
		}
		ArrayList<ITaintPropagationRule> ruleList = new ArrayList<>();
		ruleList.add(new WrapperPropagationRule<>(solverManager));
		ruleList.add(new NullRules(solverManager));
		PropagationRuleManager propagationRuleManager = new PropagationRuleManager(ruleList);

		// TODO : maybe some day add sparse methods.
		this.partiallyBalancedFlowFunctions = new NPDFlowFunctionMap(solverManager, propagationRuleManager);
	}

	/**
	 * Retrieves the program's interprocedural control flow supergraph,
	 * which represents the program structure for analysis.
	 *
	 * @return the supergraph containing all nodes and blocks.
	 */
	@Override
	public ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> getSupergraph() {
		return this.solverManager.getICFGSuperGraph();
	}

	/**
	 * Provides the domain used for mapping taint analysis elements
	 * to their corresponding basic blocks within the graph.
	 *
	 * @return the mapping domain of elements to control flow nodes.
	 */
	@Override
	public TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> getDomain() {
		return this.solverManager.getDomain();
	}

	/**
	 * Supplies the flow functions used to manage the data
	 * propagation as part of the taint analysis process.
	 *
	 * @return the object containing flow function mappings.
	 */
	@Override
	public IPartiallyBalancedFlowFunctions<BasicBlockInContext<IExplodedBasicBlock>> getFunctionMap() {
		return this.partiallyBalancedFlowFunctions;
	}

	/**
	 * Defines the initial set of edges that serve as the starting
	 * points for the interprocedural taint analysis.
	 *
	 * @return a collection of initial path edges.
	 */
	@Override
	public Collection<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> initialSeeds() {
		return this.initialSeeds;
	}

	/**
	 * Retrieves the merge function that dictates how merging of
	 * propagations occurs between paths. Returns null if no merging is required.
	 *
	 * @return the merge function or null if not applicable.
	 */
	@Override
	public IMergeFunction getMergeFunction() {
		return null;
	}

	/**
	 * Handles the transition from callee to caller using fake
	 * entry blocks to manage unbalanced parentheses scenarios.
	 *
	 * @param ssaInstructions instructions for the current block.
	 * @return the fake entry block to use for analysis.
	 */
	@Override
	public BasicBlockInContext<IExplodedBasicBlock> getFakeEntry(BasicBlockInContext<IExplodedBasicBlock> ssaInstructions) {
		CGNode node = ssaInstructions.getNode();
		return getFakeEntry(node);
	}

	/**
	 * Dynamically initializes the seeds for the analysis based on
	 * specific instructions, such as invoke operations.
	 *
	 * @return the collection of dynamically generated path edges as seeds.
	 */
	private Collection<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> initSeedsBy() {
		Set<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> result = HashSetFactory.make();
		this.solverManager.getCurrentSourceSinkGroup().sourceIterator()
			.forEachRemaining((e) -> {
				IExplodedBasicBlock delegate = e.getDelegate();
				SSAInstruction instruction = delegate.getInstruction();
				if (instruction instanceof SSAInvokeInstruction) {
					CGNode cgNode = e.getNode();
					BasicBlockInContext<IExplodedBasicBlock> bb = this.entry(cgNode);
					result.add(PathEdge.createPathEdge(bb, 0, e, 0));
				}
			});
		return result;
	}

	private BasicBlockInContext<IExplodedBasicBlock> entry(CGNode var1) {
		BasicBlockInContext<IExplodedBasicBlock>[] entriesForProcedure
			= this.solverManager.getICFGSuperGraph().getEntriesForProcedure(var1);
		assert entriesForProcedure.length == 1;
		return entriesForProcedure[0];
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

	/**
	 * Clears any cached or intermediate state maintained by
	 * the flow function map to reset or refresh its internal state.
	 */
	public void clear() {
	}
}
