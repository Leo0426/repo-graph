package com.repograph.taint;

import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.solver.IMemoryBoundedSolver;
import com.repograph.taint.solver.ISolverTerminationReason;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.dataflow.IFDS.PathEdge;
import com.ibm.wala.dataflow.IFDS.TabulationProblem;
import com.ibm.wala.dataflow.IFDS.TabulationSolver;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.MonitorUtil;
import com.ibm.wala.util.collections.HashSetFactory;
import com.ibm.wala.util.collections.Iterator2Iterable;
import com.ibm.wala.util.debug.Assertions;
import com.ibm.wala.util.intset.IntSet;

import java.util.Iterator;
import java.util.Set;


/**
 * AbstractSparseSolver is a specialized implementation of WALA's TabulationSolver.
 * It provides mechanisms to compute data flow analysis in a sparse way, reducing
 * the computational complexity of analyzing large graphs.
 * <p>
 * The methods in this class implement the rules for propagating data flow along
 * the control flow graph and handle edge cases for calls, returns, and normal edges.
 */
public class AbstractSparseSolver extends TabulationSolver<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> implements IMemoryBoundedSolver {

	/**
	 * Constructs an AbstractSparseSolver instance for a given tabulation problem
	 * and progress monitor.
	 *
	 * @param problem The tabulation problem defining flow functions, supergraph, and domain.
	 * @param monitor The progress monitor to track computation progress and cancellation.
	 */
	protected AbstractSparseSolver(TabulationProblem<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> problem,
								   MonitorUtil.IProgressMonitor monitor) {
		super(problem, monitor);
	}

	/**
	 * Retrieves the nodes this block "falls through" to, for the given variable or state.
	 * This method is unreachable by design and is overridden in subclasses if needed.
	 *
	 * @param bb The current basic block in the control flow graph.
	 * @param i  The current program state or variable.
	 */
	protected Iterator<BasicBlockInContext<IExplodedBasicBlock>> getFallThroughTo(BasicBlockInContext<IExplodedBasicBlock> bb, int i) {
		Assertions.UNREACHABLE();
		return null;
	}


	protected Iterator<BasicBlockInContext<IExplodedBasicBlock>> getFallThroughTo(BasicBlockInContext<IExplodedBasicBlock> bb1, BasicBlockInContext<IExplodedBasicBlock> bb2, int i) {
		Assertions.UNREACHABLE();
		return null;
	}


	/**
	 * Processes a normal path edge (normal data flow propagation).
	 * Normal edges connect one basic block to another within the same procedure.
	 *
	 * @param pathEdge The path edge containing context, domain state, and control flow information.
	 */
	@Override
	public void processNormal(PathEdge<BasicBlockInContext<IExplodedBasicBlock>> pathEdge) {

		this.supergraph.getSuccNodes(pathEdge.getTarget())
			.forEachRemaining(successor -> {
				IUnaryFlowFunction f = this.flowFunctionMap.getNormalFlowFunction(pathEdge.getTarget(), successor);
				IntSet D3 = this.computeFlow(pathEdge.getD2(), f);
				if (D3 != null) {
					D3.foreach(d3 -> {
						this.propagateToUse(pathEdge, pathEdge.getEntry(), pathEdge.getD1(), pathEdge.getTarget(), d3);
					});
				}
			});
	}

	/**
	 * Propagates data flow information to a return site after a procedure call.
	 * This method handles the flow of information from callee to caller.
	 *
	 * @param c       The call site block.
	 * @param entries The entry blocks for the procedure.
	 * @param retSite The return site block.
	 * @param d4      The domain element at the call site.
	 * @param D5      The set of domain elements returned.
	 * @param edge    The original path edge being propagated.
	 */
	@Override
	public void propToReturnSite(BasicBlockInContext<IExplodedBasicBlock> c,
								 BasicBlockInContext<IExplodedBasicBlock>[] entries,
								 BasicBlockInContext<IExplodedBasicBlock> retSite,
								 int d4, IntSet D5, PathEdge<BasicBlockInContext<IExplodedBasicBlock>> edge) {

		if (D5 != null) {
			D5.foreach(d5 -> {
				for (final BasicBlockInContext<IExplodedBasicBlock> s_p : entries) {
					IntSet D3 = getInversePathEdges(s_p, c, d4);
					if (D3 != null) {
						D3.foreach(d3 -> {
							this.curPathEdge = PathEdge.createPathEdge(s_p, d3, c, d4);
							this.propagateEdge(this.curPathEdge);
							this.newSummaryEdge(curPathEdge, edge, retSite, d5);
							this.propagateToUse(edge, s_p, d3, retSite, d5);
						});
					}
				}
			});
		}
	}

	/**
	 * Processes a call path edge, handling transitions from caller to callee
	 * and propagating data flow information through procedure call sites.
	 *
	 * @param pathEdge The path edge containing context, domain state, and control flow information.
	 */
	@Override
	public void processCall(PathEdge<BasicBlockInContext<IExplodedBasicBlock>> pathEdge) {
		final int targetNum = this.supergraph.getNumber(pathEdge.getTarget());
		Set<BasicBlockInContext<IExplodedBasicBlock>> returnSites = HashSetFactory.make();

		// populate allReturnSites with return sites for missing calls.
		Iterator2Iterable.make(this.supergraph.getReturnSites(pathEdge.getTarget(), null))
			.forEach(returnSites::add);

		boolean hasCallees = false;
		for (BasicBlockInContext<IExplodedBasicBlock> callee : Iterator2Iterable.make(this.supergraph.getCalledNodes(pathEdge.getTarget()))) {
			hasCallees = true;
			this.processParticularCallee(pathEdge, targetNum, returnSites, callee);
		}

		for (BasicBlockInContext<IExplodedBasicBlock> successor : Iterator2Iterable.make(this.supergraph.getNormalSuccessors(pathEdge.getTarget()))) {
			IUnaryFlowFunction unaryFlowFunction = this.flowFunctionMap.getNormalFlowFunction(pathEdge.getTarget(), successor);
			IntSet targets = this.computeFlow(pathEdge.getD2(), unaryFlowFunction);
			if (targets != null) {
				targets.foreach(t -> {
					this.newNormalExplodedEdge(pathEdge, successor, t);
					this.propagate(pathEdge.getEntry(), pathEdge.getD1(), successor, t);
				});
			}
		}

		for (BasicBlockInContext<IExplodedBasicBlock> returnSite : returnSites) {
			IUnaryFlowFunction callReturnFlowFunction = hasCallees ?
				this.flowFunctionMap.getCallToReturnFlowFunction(pathEdge.getTarget(), returnSite) :
				this.flowFunctionMap.getCallNoneToReturnFlowFunction(pathEdge.getTarget(), returnSite);

			IntSet targets = this.computeFlow(pathEdge.getD2(), callReturnFlowFunction);

			if (targets != null) {
				targets.foreach(t -> {
					assert t >= 0;
					assert pathEdge.getD1() >= 0;
					this.propagateToUse(pathEdge, pathEdge.getEntry(), pathEdge.getD1(), pathEdge.getTarget(), t);
				});
			}
		}
	}


	/**
	 * Propagates data flow to the "use" points of a variable or program state.
	 * This method ensures the flow reaches all basic blocks that make use of the propagated state.
	 *
	 * @param pathEdge The original path edge being propagated.
	 * @param s_p      The entry block in the control flow graph.
	 * @param i        The domain element at the entry block.
	 * @param n        The basic block where propagation is occurring.
	 * @param j        The propagated domain element.
	 */
	protected void propagateToUse(PathEdge<BasicBlockInContext<IExplodedBasicBlock>> pathEdge,
								  BasicBlockInContext<IExplodedBasicBlock> s_p, Integer i,
								  BasicBlockInContext<IExplodedBasicBlock> n, int j) {
		this.getFallThroughTo(n, j)
			.forEachRemaining(t -> {
				this.newNormalExplodedEdge(pathEdge, t, j);
				this.propagate(s_p, i, t, j);
			});
	}


	/**
	 * Clears all stored path edges, resetting the solver's state for a new analysis.
	 */
	public void clearPathEdges() {
		this.pathEdges.clear();
	}

	/**
	 * Clears all summary edges, removing cached summaries for flow function results.
	 */
	public void clearSummary() {
		this.summaryEdges.clear();
	}

	/**
	 * Clears all call flow edges, resetting the solver's state for interprocedural analysis.
	 */
	public void clearCallFlowEdges() {
		this.callFlowEdges.clear();
	}

	@Override
	public void forceTerminate(ISolverTerminationReason reason) {

	}

	@Override
	public boolean isTerminated() {
		return false;
	}

	@Override
	public boolean isKilled() {
		return false;
	}

	@Override
	public ISolverTerminationReason getTerminationReason() {
		return null;
	}

	@Override
	public void reset() {

	}

	@Override
	public void addStatusListener(IMemoryBoundedSolverStatusNotification notification) {

	}
}
