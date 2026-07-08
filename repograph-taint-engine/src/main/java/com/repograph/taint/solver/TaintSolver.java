package com.repograph.taint.solver;

import com.repograph.taint.api.report.taint.TaintResult;
import com.repograph.taint.sourcesink.SourceDefinition;
import com.repograph.taint.sourcesink.SourceSinkGroup;
import com.repograph.taint.ReachingDefsProblem;
import com.repograph.taint.SparseUBSolver;
import com.repograph.taint.Summarys;
import com.repograph.taint.common.CallSiteFinder;
import com.repograph.taint.common.StaticFieldAnalysis;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.TaintDomain;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.prelim.APCollector;
import com.repograph.taint.prelim.AssemblerAP;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.dataflow.IFDS.ISupergraph;
import com.ibm.wala.dataflow.IFDS.PathEdge;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.dataflow.IFDS.TabulationResult;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.impl.ExplicitCallGraph;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.collections.Pair;
import com.ibm.wala.util.intset.IntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Future;
import java.util.concurrent.TimeoutException;

import static com.repograph.taint.extutil.DFAUtils.putElementToMap;

public class TaintSolver extends AbstractTaintSolver {
	private static final Logger LOGGER = LoggerFactory.getLogger(TaintSolver.class);
	private ReachingDefsProblem problem;

	public TaintSolver(SolverManager paramSolverManager) {
		super(paramSolverManager);
	}


	public void runAnalysis() {
//		long timeout = 30L + 30L;
//		if (timeout > 30L) {
//			ScheduledThreadPoolExecutor executor = new ScheduledThreadPoolExecutor(1);
//			executor.setRemoveOnCancelPolicy(true); // 设置取消时移除任务
//
//			Future<Boolean> future = executor.submit(() -> {
//				this.runAnalysisInternal();
//				return true;
//			});
//
//			try {
//				if (future.get(timeout, TimeUnit.SECONDS)) {
//					LOGGER.info("Analysis finished normally.");
//				}
//			} catch (InterruptedException | ExecutionException | TimeoutException e) {
//				handleTaskException(future, timeout, e);
//			} finally {
//				// 确保线程池被关闭
//				executor.shutdownNow();
//			}
//		} else {
//			// 超时时间不大于30秒时同步执行
//			this.runAnalysisInternal();
//		}

		this.runAnalysisInternal();

		this.clear();  // 最后再次清理资源
	}

	private void runAnalysisInternal() {
		ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> iSupergraph = this.manager.getICFGSuperGraph();
		long l = System.nanoTime();
		AssemblerAP assemblerAP = new AssemblerAP(iSupergraph, this.manager.getSourceSinkManager().getAllSource());
		assemblerAP.runAnalysis();
		LOGGER.info("collect accessPath spend {} seconds", (System.nanoTime() - l) / 1.0E9D);

		CallGraph callgraph = this.manager.getCallgraph();
		Set<PathEdge<BasicBlockInContext<IExplodedBasicBlock>>> paths = new HashSet<>();
		CGNode zeroNode = callgraph.getFakeRootNode();
		BasicBlockInContext<IExplodedBasicBlock>[] entriesForProcedure = iSupergraph.getEntriesForProcedure(zeroNode);
		for (BasicBlockInContext<IExplodedBasicBlock> ssaInstructions : entriesForProcedure) {
			PathEdge<BasicBlockInContext<IExplodedBasicBlock>> zeroPath
				= PathEdge.createPathEdge(ssaInstructions, 0, ssaInstructions, 0);
			paths.add(zeroPath);
		}

		for (SourceSinkGroup sourceSinkGroup : this.manager.getSourceSinkManager()) {
			this.manager.setCurrentSourceSinkGroup(sourceSinkGroup);
			this.manager.setDomain(new TaintDomain<>(DomainElement.ZERO));
			this.problem = new ReachingDefsProblem(this.manager, paths);
			this.solver = SparseUBSolver.create(this.manager, problem);
			TabulationResult<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> tabulationResult = null;
			try {
				LOGGER.info("running IFDS solver...");
				long l1 = System.nanoTime();
				tabulationResult = this.solver.solve();
				LOGGER.info("TabulationSolver spend {} seconds", (System.nanoTime() - l1) / 1.0E9D);
			} catch (Exception e) {
				LOGGER.error("run analysis get an exception : {} ", e.getMessage());
			}
			long l1 = System.nanoTime();
			buildResult(tabulationResult);
			LOGGER.info("build result spend {} seconds", (System.nanoTime() - l1) / 1.0E9D);
			TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain = this.manager.getDomain();
			this.factsCount += this.manager.getDomain().getSize();
		}
		LOGGER.info("The fact counts are:{}", this.factsCount);
	}

	@Override
	public TaintResult getTaintResult() {
		return this.taintResult;
	}

	protected Map<Integer, Set<Pair<IDomainElement, SourceDefinition>>> argIndex2FlowtoDomainElements(
		BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext, IntSet fact) {
		if (fact.isEmpty()) {
			return Collections.emptyMap();
		}
		SSAInstruction paramSSAInstruction = paramBasicBlockInContext.getDelegate().getInstruction();
		if ((!(paramSSAInstruction instanceof SSAInvokeInstruction)
			&& !(paramSSAInstruction instanceof com.ibm.wala.ssa.SSAReturnInstruction))) {
			return Collections.emptyMap();
		}
		Map<Integer, Set<Pair<IDomainElement, SourceDefinition>>> paramMap = new HashMap<>();
		fact.foreach(paramInt -> {
			if (paramInt == 0) {
				return;
			}
			DomainElement domainElement = (DomainElement) this.manager.getDomain().getMappedObject(paramInt);

			AccessPath accessPath = domainElement.getAccessPath();
			int i = accessPath.getBase();

			for (int b = 0; b < paramSSAInstruction.getNumberOfUses(); b++) {
				if (paramSSAInstruction.getUse(b) == i) {

					SSAInstruction sSAInstruction = domainElement.getSource().block()
						.getDelegate().getInstruction();

					if (sSAInstruction instanceof SSAInvokeInstruction sSAInvokeInstruction) {

						Set<SourceDefinition> set = this.manager.getSourceSinkManager()
							.getSourceDefinition(this.manager.getClassHierarchy(),
								sSAInvokeInstruction.getDeclaredTarget());

						for (SourceDefinition sourceDefinition : set) {
							putElementToMap(paramMap, b, Pair.make(domainElement, sourceDefinition));
						}
					} else if (sSAInstruction instanceof com.ibm.wala.ssa.SSAReturnInstruction) {
						IMethod iMethod = domainElement.getSource().block().getMethod();
						String str1 = iMethod.getDeclaringClass().getName().toString();
						String str2 = iMethod.getReturnType().getName().toString();
						String str3 = iMethod.getName().toString();
						StringBuilder str4 = new StringBuilder();
						for (byte b1 = 0; b1 < iMethod.getNumberOfParameters(); b1++) {
							if (b1 == 0) {
								str4.append(iMethod.getParameterType(b1).getName().toString());
							} else {
								str4.append(",").append(iMethod.getParameterType(b1).getName().toString());
							}
						}
						SourceDefinition sourceDefinition
							= new SourceDefinition(str1, str2, str3, str4.toString(),
							iMethod.isStatic() ? i : (i - 1), this.manager.getRuleKind());
						putElementToMap(paramMap, b, Pair.make(domainElement, sourceDefinition));
					} else if (!(sSAInstruction instanceof com.ibm.wala.ssa.SSAPutInstruction)) {
						assert domainElement.getSource().block().isEntryBlock();
						IMethod iMethod = domainElement.getSource().block().getMethod();
						String str1 = iMethod.getDeclaringClass().getName().toString();
						String str2 = iMethod.getReturnType().getName().toString();
						String str3 = iMethod.getName().toString();
						StringBuilder str4 = new StringBuilder();
						for (byte b1 = 0; b1 < iMethod.getNumberOfParameters(); b1++) {
							if (b1 == 0) {
								str4.append(iMethod.getParameterType(b1).getName().toString());
							} else {
								str4.append(",").append(iMethod.getParameterType(b1).getName().toString());
							}
						}
						SourceDefinition sourceDefinition
							= new SourceDefinition(str1, str2, str3, str4.toString(), iMethod.isStatic() ? i : (i - 1),
							this.manager.getRuleKind());
						putElementToMap(paramMap, b, Pair.make(domainElement, sourceDefinition));
					}
				}
			}
		});
		return paramMap;
	}

	private void clear() {
		APCollector.clear();
		CallSiteFinder.clearInstance();
		StaticFieldAnalysis.clear();
		Summarys.clear();
		if (this.problem != null) {
			this.problem.clear();
		}
		if (this.manager != null) {
			CallGraph callGraph = this.manager.getCallgraph();
			if (callGraph instanceof ExplicitCallGraph) {
				((ExplicitCallGraph) callGraph).getAnalysisCache().clear();
			}
			TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain = this.manager.getDomain();
			if (domain instanceof TaintDomain) {
				((TaintDomain<?>) domain).cleanup();
			}
		}
	}

	private void handleTaskException(Future<Boolean> future, long timeout, Exception e) {
		if (e instanceof TimeoutException) {
			boolean canceled = future.cancel(true);
			LOGGER.warn("The IFDS solver timed out after {} seconds. Task canceled: {}", timeout, canceled);
		} else {
			LOGGER.error("Task execution failed: {}", e.getMessage(), e);
		}
	}
}
