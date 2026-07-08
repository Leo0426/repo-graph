package com.repograph.taint;

import com.repograph.taint.common.CallSiteFinder;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.solver.IMemoryBoundedSolver;
import com.repograph.taint.solver.ISolverTerminationReason;
import com.ibm.wala.dataflow.IFDS.CallFlowEdges;
import com.ibm.wala.dataflow.IFDS.IBinaryReturnFlowFunction;
import com.ibm.wala.dataflow.IFDS.ICFGSupergraph;
import com.ibm.wala.dataflow.IFDS.IFlowFunction;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.dataflow.IFDS.LocalPathEdges;
import com.ibm.wala.dataflow.IFDS.LocalSummaryEdges;
import com.ibm.wala.dataflow.IFDS.PartiallyBalancedTabulationProblem;
import com.ibm.wala.dataflow.IFDS.PartiallyBalancedTabulationSolver;
import com.ibm.wala.dataflow.IFDS.PathEdge;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.CancelException;
import com.ibm.wala.util.MonitorUtil;
import com.ibm.wala.util.collections.HashSetFactory;
import com.ibm.wala.util.collections.Iterator2Collection;
import com.ibm.wala.util.collections.Iterator2Iterable;
import com.ibm.wala.util.debug.Assertions;
import com.ibm.wala.util.intset.IntIterator;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;

import java.util.Collection;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.ExecutionException;

/**
 * AbstractSparseUBSolver extends PartiallyBalancedTabulationSolver and implements IMemoryBoundedSolver.
 * This class handles the propagation and processing of path edges in the presence of sparse unbalanced
 * flows in control flow graphs (CFGs).
 */

public class AbstractSparseUBSolver<T, P, F> extends PartiallyBalancedTabulationSolver<T, P, F> implements IMemoryBoundedSolver {
	public static boolean handleDisk = false;
	private ISolverTerminationReason killFlag = null;
	private Set<IMemoryBoundedSolver.IMemoryBoundedSolverStatusNotification> notificationListeners = new HashSet<>();

	protected AbstractSparseUBSolver(PartiallyBalancedTabulationProblem<T, P, F> problem, MonitorUtil.IProgressMonitor monitor) {
		super(problem, monitor);
	}

	public Iterator<T> getFallThroughTo(T block, int d) {
		Assertions.UNREACHABLE();
		return null;
	}

	protected boolean propagateInternal(T src, int d1, T dest, int d2) {
		int targetNumber = this.supergraph.getLocalBlockNumber(dest);
		if (targetNumber < 0) {
			System.err.println("BOOM " + dest);
			this.supergraph.getLocalBlockNumber(dest);
		}
		assert targetNumber >= 0;

		LocalPathEdges pathEdges = this.findOrCreateLocalPathEdges(src);
		assert d2 >= 0;

		if (!pathEdges.contains(d1, targetNumber, d2)) {
			pathEdges.addPathEdge(d1, targetNumber, d2);
			this.addToWorkList(src, d1, dest, d2);
			return true;
		} else {
			return false;
		}
	}

	public void forwardTabulateSLRPs() throws CancelException {
		assert this.curPathEdge == null : "curPathEdge should not be non-null here";

		if (this.worklist == null) {
			this.worklist = this.makeWorklist();
		}

		while (this.worklist.size() > 0) {
			if (this.killFlag != null) return;

			MonitorUtil.throwExceptionIfCanceled(this.progressMonitor);
			if (verbose) this.performVerboseAction();
			this.tendToSoftCaches();

			PathEdge<T> edge = this.popFromWorkList();
			this.curPathEdge = edge;

			int d2Merged = this.merge(edge.getEntry(), edge.getD1(), edge.getTarget(), edge.getD2());
			if (d2Merged != -1) {
				if (d2Merged != edge.getD2()) {
					this.propagate(edge.getEntry(), edge.getD1(), edge.getTarget(), d2Merged);
				} else if (this.supergraph.isCall(edge.getTarget())) {
					this.processCall(edge);
				} else if (this.supergraph.isExit(edge.getTarget())) {
					if (this.wasUsedAsUnbalancedSeed(edge.getEntry(), edge.getD1())) {
						this.processUBExit(edge.getEntry(), edge.getD1(), edge.getTarget(), d2Merged);
					} else {
						this.processExit(edge);
					}
				} else {
					this.processNormal(edge);
				}
			}
		}

		this.curPathEdge = null;
	}

	protected void processUBExit(T entry, int d1, T exit, int d2) {
		for (T succ : Iterator2Iterable.make(this.supergraph.getSuccNodes(exit))) {
			PartiallyBalancedTabulationProblem<T, P, F> problem = (PartiallyBalancedTabulationProblem<T, P, F>) this.getProblem();
			IFlowFunction flowFunction = problem.getFunctionMap().getUnbalancedReturnFlowFunction(exit, succ);
			if (flowFunction instanceof IUnaryFlowFunction) {
				IUnaryFlowFunction unaryFlowFunction = (IUnaryFlowFunction) flowFunction;
				IntSet targets = unaryFlowFunction.getTargets(d2);
				if (targets != null) {
					IntIterator it = targets.intIterator();
					while (it.hasNext()) {
						int dTarget = it.next();
						T fakeEntry = problem.getFakeEntry(succ);
						try {
							CallSiteFinder.getInstance((ICFGSupergraph) this.supergraph)
								.getAllCallSite((BasicBlockInContext<IExplodedBasicBlock>) exit, (BasicBlockInContext<IExplodedBasicBlock>) succ, (IDomainElement) problem.getDomain().getMappedObject(d2))
								.stream()
								.filter(site -> site.getNode().equals(((BasicBlockInContext<?>) succ).getNode()))
								.forEach(site -> this.getFallThroughTo((T) site, dTarget)
									.forEachRemaining(e -> {
										PathEdge<T> pathEdge = PathEdge.createPathEdge(fakeEntry, dTarget, e, dTarget);
										this.addSeed(pathEdge);
									}));
						} catch (ExecutionException e) {
							throw new RuntimeException(e);
						}
						this.newUnbalancedExplodedReturnEdge(entry, d1, exit, d2);
					}
				}
			} else {
				Assertions.UNREACHABLE("Partially balanced logic not supported for binary return flow functions");
			}
		}
	}

	public boolean propagate(T entry, int d1, T exit, int d2) {
		if (this.killFlag != null) {
			return false;
		} else {
			return this.propagateInternal(entry, d1, exit, d2);
		}
	}

	public void processNormal(final PathEdge<T> edge) {
		for (T m : Iterator2Iterable.make(this.supergraph.getSuccNodes(edge.getTarget()))) {
			IUnaryFlowFunction f = this.flowFunctionMap.getNormalFlowFunction(edge.getTarget(), m);
			IntSet D3 = this.computeFlow(edge.getD2(), f);
			if (D3 != null) {
				D3.foreach((d3) -> {
					this.propegateToUse(edge, edge.getEntry(), edge.getD1(), edge.getTarget(), d3);
				});
			}
		}

	}

	public void propToReturnSite(final T c, final T[] entries, final T retSite, final int d4, final IntSet D5, final PathEdge<T> edge) {
		if (D5 != null) {
			D5.foreach((d5) -> {
				for (T s_p : entries) {
					IntSet D3 = this.getInversePathEdges(s_p, c, d4);
					if (D3 != null) {
						D3.foreach((d3) -> {
							this.curPathEdge = PathEdge.createPathEdge(s_p, d3, c, d4);
							this.newSummaryEdge(this.curPathEdge, edge, retSite, d5);
							this.propegateToUse(edge, s_p, d3, retSite, d5);
						});
					}
				}

			});
		}

	}

	public void processCall(final PathEdge<T> edge) {
		int c = this.supergraph.getNumber(edge.getTarget());
		Collection<T> allReturnSites = HashSetFactory.make();

		for (T retSite : Iterator2Iterable.make(this.supergraph.getReturnSites(edge.getTarget(), null))) {
			allReturnSites.add(retSite);
		}

		boolean hasCallee = false;

		for (T callee : Iterator2Iterable.make(this.supergraph.getCalledNodes(edge.getTarget()))) {
			hasCallee = true;
			this.processParticularCallee(edge, c, allReturnSites, callee);
		}

		for (T m : Iterator2Iterable.make(this.supergraph.getNormalSuccessors(edge.getTarget()))) {
			IUnaryFlowFunction f = this.flowFunctionMap.getNormalFlowFunction(edge.getTarget(), m);
			IntSet D3 = this.computeFlow(edge.getD2(), f);
			if (D3 != null) {
				D3.foreach((d3) -> {
					this.newNormalExplodedEdge(edge, m, d3);
					this.propagate(edge.getEntry(), edge.getD1(), m, d3);
				});
			}
		}

		for (T returnSite : allReturnSites) {
			IUnaryFlowFunction f;
			if (hasCallee) {
				f = this.flowFunctionMap.getCallToReturnFlowFunction(edge.getTarget(), returnSite);
			} else {
				f = this.flowFunctionMap.getCallNoneToReturnFlowFunction(edge.getTarget(), returnSite);
			}

			IntSet reached = this.computeFlow(edge.getD2(), f);
			if (reached != null) {
				reached.foreach((x) -> {
					assert x >= 0;

					assert edge.getD1() >= 0;

					this.propegateToUse(edge, edge.getEntry(), edge.getD1(), edge.getTarget(), x);
				});
			}
		}

	}

	protected void propegateToUse(PathEdge<T> path, T entry, int d1, T exit, int d2) {
		this.getFallThroughTo(exit, d2).forEachRemaining(e -> {
			this.newCallExplodedEdge(path, e, d2);
			this.propagate(entry, d1, e, d2);
		});
	}

	public void processParticularCallee(final PathEdge<T> edge, final int callNodeNum, Collection<T> allReturnSites, final T calleeEntry) {
		MutableSparseIntSet reached = MutableSparseIntSet.makeEmpty();
		Collection<T> returnSitesForCallee = Iterator2Collection.toSet(this.supergraph.getReturnSites(edge.getTarget(), this.supergraph.getProcOf(calleeEntry)));
		allReturnSites.addAll(returnSitesForCallee);

		for (T returnSite : returnSitesForCallee) {
			IUnaryFlowFunction f = this.flowFunctionMap.getCallFlowFunction(edge.getTarget(), calleeEntry, returnSite);
			IntSet r = this.computeFlow(edge.getD2(), f);
			if (r != null) {
				reached.addAll(r);
			}
		}

		IUnaryFlowFunction f = this.flowFunctionMap.getCallFlowFunction(edge.getTarget(), calleeEntry, null);
		IntSet r = this.computeFlow(edge.getD2(), f);
		if (r != null) {
			reached.addAll(r);
		}

		if (reached != null) {
			P procOf = this.supergraph.getProcOf(calleeEntry);
			LocalSummaryEdges summaries = this.summaryEdges.get(procOf);
			CallFlowEdges callFlow = this.findOrCreateCallFlowEdges(calleeEntry);
			int s_p_num = this.supergraph.getLocalBlockNumber(calleeEntry);
			reached.foreach((d1) -> {
				boolean gotReuse = !this.propagate(calleeEntry, d1, calleeEntry, d1);
				this.recordCall(edge.getTarget(), calleeEntry, d1, gotReuse);
				this.newCallExplodedEdge(edge, calleeEntry, d1);
				callFlow.addCallEdge(callNodeNum, edge.getD2(), d1);
				if (summaries != null) {
					P p = (P) this.supergraph.getProcOf(calleeEntry);
					T[] exits = (T[]) this.supergraph.getExitsForProcedure(p);

					for (T exit : exits) {
						int x_num = this.supergraph.getLocalBlockNumber(exit);
						IntSet reachedBySummary = summaries.getSummaryEdges(s_p_num, x_num, d1);
						if (reachedBySummary != null) {
							for (T returnSite : returnSitesForCallee) {
								if (this.supergraph.hasEdge(exit, returnSite)) {
									IFlowFunction retf = this.flowFunctionMap.getReturnFlowFunction(edge.getTarget(), exit, returnSite);
									reachedBySummary.foreach((d2) -> {
										assert this.curSummaryEdge == null : "curSummaryEdge should be null here";

										this.curSummaryEdge = PathEdge.createPathEdge(calleeEntry, d1, exit, d2);
										if (retf instanceof IBinaryReturnFlowFunction) {
											IntSet D51 = this.computeBinaryFlow(edge.getD2(), d2, (IBinaryReturnFlowFunction) retf);
											if (D51 != null) {
												D51.foreach((d5) -> {
													this.newSummaryEdge(edge, this.curSummaryEdge, returnSite, d5);
													this.propegateToUse(edge, edge.getEntry(), edge.getD1(), returnSite, d5);
												});
											}
										} else {
											IntSet D52 = this.computeFlow(d2, (IUnaryFlowFunction) retf);
											if (D52 != null) {
												D52.foreach((d5) -> {
													this.newSummaryEdge(edge, this.curSummaryEdge, returnSite, d5);
													this.propegateToUse(edge, edge.getEntry(), edge.getD1(), returnSite, d5);
												});
											}
										}

										this.curSummaryEdge = null;
									});
								}
							}
						}
					}
				}

			});
		}

	}


	public void forceTerminate(ISolverTerminationReason reason) {
		this.killFlag = reason;
	}

	public boolean isTerminated() {
		return this.killFlag != null;
	}

	public boolean isKilled() {
		return this.killFlag != null;
	}

	public ISolverTerminationReason getTerminationReason() {
		return this.killFlag;
	}

	public void reset() {
		this.killFlag = null;
	}

	public void addStatusListener(IMemoryBoundedSolver.IMemoryBoundedSolverStatusNotification listener) {
		this.notificationListeners.add(listener);
	}


	public void clearPathEdges() {
		this.pathEdges.clear();
	}

	public void clearSummary() {
		this.summaryEdges.clear();
	}

	public void clearCallFlowEdges() {
		this.callFlowEdges.clear();
	}
}

