package com.repograph.taint.npdnorm.ifds.solver;

import com.repograph.taint.api.report.taint.TaintResult;
import com.repograph.taint.sourcesink.SourceSinkGroup;
import com.repograph.taint.common.CallSiteFinder;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.NPDDomainElement;
import com.repograph.taint.npdnorm.ifds.NullPointerDeferenceDomain;
import com.repograph.taint.npdnorm.ifds.NullPointerSparseSolver;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.dataflow.IFDS.ICFGSupergraph;
import com.ibm.wala.dataflow.IFDS.PathEdge;
import com.ibm.wala.dataflow.IFDS.TabulationResult;
import com.ibm.wala.dataflow.IFDS.TabulationSolver;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.CancelException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashSet;
import java.util.Set;

/**
 * npd solver.
 *
 * @author leo
 * @since 2024/12/3
 */
public class NPDSolver extends AbstractNPDSolver {

	private static final Logger LOGGER = LoggerFactory.getLogger(NPDSolver.class);

	public NPDSolver(SolverManager solverManager) {
		this.manager = solverManager;
	}

	private void clear() {
		CallSiteFinder.clearInstance();
	}

	public void runAnalysis() {
		this.runAnalysisInternal();
	}

	public void runAnalysisInternal() {

		CallGraph cg = this.manager.getCallgraph();
		ICFGSupergraph icfgSupergraph = ICFGSupergraph.make(cg);
		Set<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> paths = new HashSet<>();

		CGNode zeroNode = cg.getFakeRootNode();
		BasicBlockInContext<IExplodedBasicBlock>[] entriesForProcedure = icfgSupergraph.getEntriesForProcedure(zeroNode);

		for (BasicBlockInContext<IExplodedBasicBlock> ssaInstructions : entriesForProcedure) {
			PathEdge<BasicBlockInContext<IExplodedBasicBlock>> zeroPath
				= PathEdge.createPathEdge(ssaInstructions, 0, ssaInstructions, 0);
			paths.add(zeroPath);
		}

		this.solveNPE(paths);

		if (!this.manager.getSourceSinkManager().getAllSource().isEmpty()) {
			for (SourceSinkGroup sourceSinkGroup : this.manager.getSourceSinkManager()) {
				if (sourceSinkGroup != null) {
					this.manager.setCurrentSourceSinkGroup(sourceSinkGroup);
					this.solveNPE(paths);
				}
			}
		}
	}

	private void solveNPE(Set<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> pathEdges) {
		this.manager.setDomain(new NullPointerDeferenceDomain<>(NPDDomainElement.ZERO));
		NpdProblem npdProblem = new NpdProblem(this.manager, pathEdges);
		TabulationSolver<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> make = NullPointerSparseSolver.make(npdProblem);
		try {
			TabulationResult<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> solve = make.solve();
			this.buildResult(solve);
		} catch (CancelException c) {
			LOGGER.error("Problem while solving npd problem : {}", c.getMessage());
		}
	}

	public TaintResult getAnswer() {
		return this.mResult;
	}
}
