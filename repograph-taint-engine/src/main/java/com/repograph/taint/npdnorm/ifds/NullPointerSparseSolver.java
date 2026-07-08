package com.repograph.taint.npdnorm.ifds;

import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.AbstractSparseSolver;
import com.ibm.wala.dataflow.IFDS.PathEdge;
import com.ibm.wala.dataflow.IFDS.TabulationProblem;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.MonitorUtil;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.IntSetAction;


public class NullPointerSparseSolver extends AbstractSparseSolver {

	/**
	 * Constructor for NullPointerSparseSolver.
	 *
	 * @param problem The tabulation problem being solved.
	 * @param monitor Progress monitor for tracking computation progress.
	 */
	protected NullPointerSparseSolver(TabulationProblem<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> problem,
									  MonitorUtil.IProgressMonitor monitor) {
		super(problem, monitor);
	}

	/**
	 * Processes a normal flow edge in the control flow graph.
	 *
	 * @param pathEdge The path edge to process.
	 */
//	@Override
//	public void processNormal(PathEdge<BasicBlockInContext<IExplodedBasicBlock>> pathEdge) {
//		Iterator<BasicBlockInContext<IExplodedBasicBlock>> successors = this.supergraph.getSuccNodes(pathEdge.getTarget());
//
//		while (successors.hasNext()) {
//			BasicBlockInContext<IExplodedBasicBlock> successor = successors.next();
//			IUnaryFlowFunction flowFunction = flowFunctionMap.getNormalFlowFunction(pathEdge.getTarget(), successor);
//			IntSet targets = computeFlow(pathEdge.getD2(), flowFunction);
//
//			if (targets != null) {
//				targets.foreach(d3 -> {
//					this.propegateToUse(pathEdge, pathEdge.getEntry(), pathEdge.getD1(), successor, d3);
//				});
//			}
//		}
//	}

	/**
	 * BasicBlockInContext var1, BasicBlockInContext[] var2, BasicBlockInContext var3, int var4, IntSet var5, PathEdge var6
	 * <p>
	 * this, var2, var1, var4, var6, var3
	 */
	@Override
	public void propToReturnSite(BasicBlockInContext<IExplodedBasicBlock> c,  // bL
								 BasicBlockInContext<IExplodedBasicBlock>[] entries, // bk
								 BasicBlockInContext<IExplodedBasicBlock> retSite, // b0
								 int d4, IntSet D5, PathEdge<BasicBlockInContext<IExplodedBasicBlock>> edge) {
		if (D5 != null) {
			D5.foreach(d5 -> {
				for (final BasicBlockInContext<IExplodedBasicBlock> s_p : entries) {
					IntSet D3 = this.getInversePathEdges(s_p, c, d4);
					if (D3 != null) {
						D3.foreach(new IntSetAction() {
									   @Override
									   public void act(int i) {
										   for (BasicBlockInContext<IExplodedBasicBlock> var5 : entries) {
											   IntSet var6 = getInversePathEdges(var5, c, d4);
											   if (var6 != null) {
												   var6.foreach((var7) -> {
//													   processNormal(PathEdge.createPathEdge(var5, var7, var2, var3));
//													   a(var4, var5x, var1);
//													   this.bP.a(var4, var5, var7, var2, var1);
												   });
											   }
										   }
									   }
								   }
						);
					}
				}
			});
		}
	}

//	/**
//	 * Processes a call edge in the control flow graph.
//	 *
//	 * @param edge The path edge to process.
//	 */
//	@Override
//	public void processCall(PathEdge<BasicBlockInContext<IExplodedBasicBlock>> edge) {
//		int targetNodeNumber = supergraph.getNumber(edge.getTarget());
//		HashSet<BasicBlockInContext<IExplodedBasicBlock>> returnSites = HashSetFactory.make();
//
//		for (BasicBlockInContext<IExplodedBasicBlock> returnSite : Iterator2Iterable.make(supergraph.getReturnSites(edge.getTarget(), null))) {
//			returnSites.add(returnSite);
//		}
//
//		boolean hasCallees = false;
//
//		for (BasicBlockInContext<IExplodedBasicBlock> callee : Iterator2Iterable.make(supergraph.getCalledNodes(edge.getTarget()))) {
//			hasCallees = true;
//			processParticularCallee(edge, targetNodeNumber, returnSites, callee);
//		}
//
//		for (BasicBlockInContext<IExplodedBasicBlock> normalSuccessor : Iterator2Iterable.make(supergraph.getNormalSuccessors(edge.getTarget()))) {
//			IUnaryFlowFunction normalFlowFunction = flowFunctionMap.getNormalFlowFunction(edge.getTarget(), normalSuccessor);
//			IntSet computedFlow = computeFlow(edge.getD2(), normalFlowFunction);
//
//			if (computedFlow != null) {
//				computedFlow.foreach(flowFact -> {
//					newNormalExplodedEdge(edge, normalSuccessor, flowFact);
//					propagate(edge.getEntry(), edge.getD1(), normalSuccessor, flowFact);
//				});
//			}
//		}
//
//		for (BasicBlockInContext<IExplodedBasicBlock> returnSite : returnSites) {
//			IUnaryFlowFunction callToReturnFlowFunction = hasCallees
//				? flowFunctionMap.getCallToReturnFlowFunction(edge.getTarget(), returnSite)
//				: flowFunctionMap.getCallNoneToReturnFlowFunction(edge.getTarget(), returnSite);
//
//			IntSet computedFlow = computeFlow(edge.getD2(), callToReturnFlowFunction);
//
//			if (computedFlow != null) {
//				computedFlow.foreach(flowFact -> {
//					assert flowFact >= 0;
//					assert edge.getD1() >= 0;
//
//					propagateToUse(edge, edge.getEntry(), edge.getD1(), returnSite, flowFact);
//				});
//			}
//		}
//	}

//	/**
//	 * Propagates flow facts to their usage sites.
//	 *
//	 * @param edge        The path edge being processed.
//	 * @param sourceBlock The source basic block.
//	 * @param factD1      The input fact D1.
//	 * @param targetBlock The target basic block.
//	 * @param factD2      The input fact D2.
//	 */
//	protected void handleFallThrough(PathEdge<BasicBlockInContext<IExplodedBasicBlock>> edge,
//									 BasicBlockInContext<IExplodedBasicBlock> sourceBlock, Integer factD1,
//									 BasicBlockInContext<IExplodedBasicBlock> targetBlock, int factD2) {
//		this.getFallThroughTo(edge.getTarget(), targetBlock, factD2)
//			.forEachRemaining(e -> {
//
//			});
//	}
//
//	/**
//	 * Internal utility method for fall-through propagation.
//	 *
//	 * @param edge        The path edge being processed.
//	 * @param sourceBlock The source basic block.
//	 * @param factD1      The input fact D1.
//	 * @param targetBlock The target basic block.
//	 * @param factD2      The input fact D2.
//	 */
//	protected void propagateToUse(PathEdge<BasicBlockInContext<IExplodedBasicBlock>> edge,
//								  BasicBlockInContext<IExplodedBasicBlock> sourceBlock, Integer factD1,
//								  BasicBlockInContext<IExplodedBasicBlock> targetBlock, int factD2) {
//		this.getFallThroughTo(targetBlock, targetBlock, factD2)
//			.forEachRemaining(e -> {
//
//			});
//	}
}
